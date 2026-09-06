"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Replay as ReplayData } from "@/lib/episodes";
import { buildMarkers, exportClip, FORMATS, type Shape } from "@/lib/export";
import { MAX_CLIP_SECONDS, OUTRO_SECONDS } from "@/lib/clip";
import { save } from "@/lib/record";
import { play, readMuted, unlock, writeMuted } from "@/lib/sound";
import {
  clock,
  duration,
  pct,
  price,
  signedUsd,
  size,
  usdCompact,
} from "@/lib/format";
import { CoinIcon } from "./CoinIcon";
import { Panel } from "./Panel";
import { VenueMark } from "./VenueMark";
import { sameIdentity } from "@/lib/venue";

const GROUND = "#0f1a1e";
const BORDER = "#273035";
const MUTED = "#9aa3a4";
const UP = "#50d2c1";
const DOWN = "#ed7088";
const ACCENT = "#97fce4";

/**
 * How long one bar is held at 1x.
 *
 * Six hundred milliseconds is the single thing that decides whether a replay is watchable.
 * Normalising the whole thing to a fixed total
 * duration was the mistake: it meant a four-hundred-bar hold ran at fifty milliseconds a
 * bar, so the candles blurred past and nothing could be read. A bar deserves the same time
 * whatever else is in the chart, and anyone who wants it faster has the speed control.
 */
const STEP_MS = 600;

/**
 * Pixels per bar. The fixed value deciding how wide a candle looks.
 *
 * Fixed rather than derived from the bar count, so a nine-hundred-bar hold draws the same
 * candle as a forty-bar scalp and the chart scrolls instead of squeezing.
 */
const BAR_SPACING = 9;

/**
 * Every bar gets the same time. There is no emphasis and that is deliberate.
 *
 * Holding fill bars longer than quiet ones sounded like a good idea and watched terribly:
 * the replay lurched, ran, lurched again, and read as stuttering rather than as emphasis,
 * because a viewer has no way to know that the pause means something. A constant rate is
 * what makes the price action itself the thing that varies.
 */

const SPEEDS = [1, 2, 4, 8] as const;

/**
 * Once per this much gained, the fanfare sounds.
 *
 * A high-water mark rather than a threshold, so a position that dips and recovers does
 * not sound the same step twice — it fires on GAINING another twenty thousand, not on
 * wobbling across a line. Five hundred was a carnival: a good trade chimed every few
 * bars the whole way up.
 */
const FANFARE_AT = 20_000;

/** How long a fill's label holds over the chart before leaving. */
const FLASH_MS = 1_400;

/**
 * One fill announcing itself over the chart.
 *
 * `enter` for one frame so the transition has somewhere to come from, then `shown`,
 * then `out` — either when its time is up or when the next fill needs the space.
 */
interface Flash {
  id: number;
  isBuy: boolean;
  liq: boolean;
  usd: number;
  /** Volume-weighted price of the fills the label sums. */
  px: number;
  /** Stacking offset, so a buy and a sell in one bar do not sit on each other. */
  slot: number;
  phase: "enter" | "shown" | "out";
  bornAt: number;
  outAt?: number;
}

let flashId = 0;

/**
 * Rows the fill table will render.
 *
 * A TWAP'd position can carry a thousand fills. Rendering all of them costs a thousand DOM
 * nodes to show a list nobody scrolls to the bottom of, so the biggest are kept and the
 * header says what was left out.
 */
const MAX_FILL_ROWS = 150;

export function Replay({ data, onClose }: { data: ReplayData; onClose?: () => void }) {
  const priceRef = useRef<HTMLDivElement>(null);
  const pnlRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const pnlSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const paintedRef = useRef(-1);
  /** Highest bar the soundtrack has already reacted to, so scrubbing back stays silent. */
  const soundedRef = useRef(-1);
  const milestoneRef = useRef(0);

  const [cursor, setCursor] = useState(0);
  /**
   * Autoplay is the whole point of this screen, except for somebody who has asked the
   * system for less motion. The stylesheet can flatten a transition but it cannot stop
   * a canvas being repainted every frame, so the replay opens paused instead and they
   * press play. Read in the initialiser rather than an effect, so the first painted
   * frame is already still; safe because a replay only ever mounts client-side, after
   * a row is opened.
   */
  const [playing, setPlaying] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  /**
   * Playback actually reached the end, which is not the same as the cursor being on the
   * last bar. The cursor lands there the moment that bar STARTS forming, so keying the end
   * card off it put the card up over a candle that was still growing, and then held it
   * while the last of the price action happened behind it.
   */
  const [finished, setFinished] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
  const muted = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener("runback-mute", onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener("runback-mute", onChange);
      };
    },
    readMuted,
    () => false,
  );
  /**
   * Fills currently announcing themselves over the chart.
   *
   * Held in state rather than drawn into the canvas because the chart library owns that
   * canvas — anything painted there is wiped on the next update, and a fill's flash has
   * to outlive the bar that produced it.
   */
  const [flashes, setFlashes] = useState<Flash[]>([]);

  const bars = data.candles.length;
  const wasLiquidated = useCallback(
    (f: { liquidatedUser: string | null }) =>
      !!f.liquidatedUser && sameIdentity(f.liquidatedUser, data.wallet),
    [data.wallet],
  );

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) setPlaying(false);
      else unlock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    unlock();
  }, []);

  /* ------------------------------------------------------------ pre-work */

  const candleData = useMemo<CandlestickData<Time>[]>(
    () =>
      data.candles.map((c) => ({
        time: (c.t / 1000) as UTCTimestamp,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    [data.candles],
  );

  const pnlData = useMemo<LineData<Time>[]>(
    () => data.points.map((p) => ({ time: (p.t / 1000) as UTCTimestamp, value: p.total })),
    [data.points],
  );

  /** Which bar a moment falls in. Binary search, because a chart can hold 1,200 of them. */
  const barOf = useCallback(
    (ts: number): number => {
      let lo = 0;
      let hi = data.candles.length - 1;
      if (hi < 0) return -1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (data.candles[mid]!.t <= ts) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [data.candles],
  );

  const fillsAtBar = useMemo(() => {
    const map = new Map<number, typeof data.fills>();
    for (const f of data.fills) {
      const b = barOf(f.time);
      if (b < 0) continue;
      const list = map.get(b);
      if (list) list.push(f);
      else map.set(b, [f]);
    }
    return map;
  }, [data, barOf]);

  /**
   * The wallet's fills as chart markers, built by the same function the exporter uses.
   *
   * One arrow per bar per side rather than one arrow per fill — a position built out
   * of a TWAP or a swept market order (MEASURED: 911 fills on one HIP-3 market maker)
   * otherwise stacks into an unreadable ribbon, and the per-frame filter's cost scales
   * with fill count. `upto` turns that filter into a slice of a pre-sorted array.
   */
  const { markers: allMarkers, upto: markersUpto, cues: barCues } = useMemo(
    () => buildMarkers(data),
    [data],
  );

  /* -------------------------------------------------------------- charts */

  useEffect(() => {
    const el = priceRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { color: GROUND },
        textColor: MUTED,
        fontFamily: "inherit",
        fontSize: 11,
        attributionLogo: false,
      },
      /**
       * Both axes ruled, faintly. The terminal draws a full grid; only horizontals made
       * the chart look like a widget embedded in something else.
       */
      grid: {
        vertLines: { color: "#ffffff07" },
        horzLines: { color: "#ffffff07" },
      },
      rightPriceScale: {
        borderColor: BORDER,
        scaleMargins: { top: 0.2, bottom: 0.1 },
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: BORDER,
        timeVisible: true,
        secondsVisible: false,
        /**
         * A fixed bar width with room held ahead of the newest bar, and then never touched
         * again. This is how a live chart behaves and it is what I had been fighting.
         *
         * Setting a visible logical range instead meant the first bar was pinned wherever
         * that range put it, which is why the replay opened with one candle jammed against
         * an edge and ninety-four bars of nothing beside it. `barSpacing` fixes how wide a
         * candle is, `rightOffset` leaves half a screen of empty space for the next move to
         * go into, and `shiftVisibleRangeOnNewBar` scrolls when a bar lands.
         */
        barSpacing: BAR_SPACING,
        rightOffset: Math.round((el.clientWidth || 900) / BAR_SPACING / 2),
        shiftVisibleRangeOnNewBar: true,
        lockVisibleTimeRangeOnResize: true,
      },
      /**
       * A crosshair that reads values, which is the whole reason theirs has one. It was
       * off, so hovering the chart did nothing and it felt inert next to the real thing.
       */
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#9aa3a466",
          width: 1,
          style: 2,
          labelBackgroundColor: BORDER,
        },
        horzLine: {
          color: "#9aa3a466",
          width: 1,
          style: 2,
          labelBackgroundColor: BORDER,
        },
      },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      /** The live mark, tagged on the scale, exactly as the terminal carries it. */
      priceLineVisible: true,
      priceLineColor: "#9aa3a4",
      priceLineWidth: 1,
      priceLineStyle: 2,
      lastValueVisible: true,
    });

    /**
     * Average entry sits on the chart the whole way through. Without it there is no
     * reference for whether the candle being watched is above or below where the position
     * was opened, which is the only thing that makes the moving number legible.
     */
    if (data.avgEntry > 0) {
      series.createPriceLine({
        price: data.avgEntry,
        color: MUTED,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "entry",
      });
    }

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    paintedRef.current = -1;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, [candleData, data.avgEntry]);

  useEffect(() => {
    const el = pnlRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { color: GROUND },
        textColor: MUTED,
        fontFamily: "inherit",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: "transparent" } },
      rightPriceScale: {
        borderColor: "transparent",
        scaleMargins: { top: 0.18, bottom: 0.18 },
      },
      timeScale: { visible: false, borderColor: "transparent" },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    const series = chart.addSeries(LineSeries, {
      color: ACCENT,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Zero is the only meaningful reference on a PnL curve.
    series.createPriceLine({
      price: 0,
      color: BORDER,
      lineWidth: 1,
      lineStyle: 0,
      axisLabelVisible: false,
      title: "",
    });

    pnlSeriesRef.current = series;
    return () => {
      chart.remove();
      pnlSeriesRef.current = null;
    };
  }, [pnlData]);

  /* ------------------------------------------------------------ painting */

  /**
   * Draw the chart at bar `index`, `frac` of the way through it.
   *
   * Imperative, and called from the animation loop every frame rather than from an effect
   * on every cursor change, because the interesting part happens BETWEEN bars. A bar that
   * simply appears at full size is a slideshow; a bar that opens flat and grows to its
   * close while its wick extends is a market moving, which is the whole thing people are
   * here to watch.
   */
  const paintTo = useCallback(
    (index: number, frac: number) => {
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (!series || !chart || bars === 0) return;
      const i = Math.min(Math.max(index, 0), bars - 1);

      if (paintedRef.current !== i) {
        /**
         * The bar that was forming is history now, so snap it to its real close.
         *
         * Leaving it out is what made the whole chart look wrong. Every bar was frozen at
         * whatever fraction of its move it had reached when the cursor stepped off it, so a
         * replay left a trail of stunted candles behind the one currently growing. Nothing
         * on screen was the price.
         */
        if (i > 0 && paintedRef.current === i - 1) {
          series.update(candleData[i - 1]!);
        } else {
          /**
           * Any other jump, forwards or back, rebuilds. `slice(0, i)` and not `i + 1`,
           * because bar `i` is about to be added by the forming update below; adding it
           * here and then updating it is what threw "Cannot update oldest data" after a
           * restart, when the series still held the whole replay and was handed bar zero.
           */
          series.setData(candleData.slice(0, i));
          chart.timeScale().scrollToRealTime();
        }

        markersRef.current?.setMarkers(allMarkers.slice(0, markersUpto[i] ?? 0));
        pnlSeriesRef.current?.setData(pnlData.slice(0, i + 1));
        paintedRef.current = i;
      }

      const bar = candleData[i]!;
      const raw = Math.min(Math.max(frac, 0), 1);
      /** Smoothstep: a linear walk reads mechanical, which is what a slideshow looks like. */
      const p = raw * raw * (3 - 2 * raw);
      const close = bar.open + (bar.close - bar.open) * p;
      series.update({
        time: bar.time,
        open: bar.open,
        close,
        // Wick grows out of the open alongside the body, as a live candle's does.
        high: Math.max(bar.open, close, bar.open + (bar.high - bar.open) * p),
        low: Math.min(bar.open, close, bar.open + (bar.low - bar.open) * p),
      });
    },
    [bars, candleData, pnlData, allMarkers, markersUpto],
  );

  /**
   * Redraw on anything that is not the animation loop: a scrub, a pause, a restart, a
   * fresh chart.
   *
   * While the clock is running the loop owns the chart and this stays out of its way.
   * Painting here too put a fully-formed copy of each new bar up for the one frame
   * between the cursor landing and the loop's next paint, so every bar blinked to full
   * height before shrinking back to grow. Pausing, on the other hand, snaps the bar
   * being formed to its real close, which makes a paused frame read as the market rather
   * than as half a candle.
   */
  useEffect(() => {
    if (playing) return;
    paintTo(cursor, 1);
  }, [cursor, playing, paintTo]);

  /* --------------------------------------------------------------- sound */

  /**
   * Sound follows the arrows, on the same frame the chart paints them.
   *
   * Keying this off a `cursor` effect meant the ping waited for React to commit,
   * and a skipped-frame jump delivered every pending cue in one call. The clock
   * loop calls this as it crosses a bar — the same moment `paintTo` draws the
   * arrow — and a paused scrub still goes through the effect below. One cue per
   * marker: a buy arrow ticks, a sell arrow ticks lower, a liquidation keeps its
   * weight. Fills too small to mark stay silent. The fanfare is a high-water
   * mark every $20K, armed at the opening bar so a window that opens mid-position
   * does not begin with four stacked blasts.
   */
  const mutedRef = useRef(muted);
  const barCuesRef = useRef(barCues);
  const pointsRef = useRef(data.points);
  useEffect(() => {
    mutedRef.current = muted;
    barCuesRef.current = barCues;
    pointsRef.current = data.points;
  }, [muted, barCues, data.points]);

  const soundTo = useCallback(
    (index: number) => {
      if (bars === 0) return;
      const upto = Math.min(index, bars - 1);

      if (upto <= soundedRef.current) {
        soundedRef.current = upto;
      } else {
        for (let b = soundedRef.current + 1; b <= upto; b += 1) {
          for (const cue of barCuesRef.current[b] ?? []) play(cue, mutedRef.current);
        }
        soundedRef.current = upto;
      }

      const total = pointsRef.current[upto]?.total ?? 0;
      const reached = Math.max(Math.floor(total / FANFARE_AT), 0);
      if (upto === 0) milestoneRef.current = reached;
      else if (reached > milestoneRef.current) {
        milestoneRef.current = reached;
        play("profit", mutedRef.current);
      }
    },
    [bars],
  );

  useEffect(() => {
    if (playing) return;
    soundTo(cursor);
  }, [cursor, playing, soundTo]);

  /**
   * The full stop, on the end card rather than on the last bar.
   *
   * Fired once per ending. `muted` has to stay a dependency for the current value to
   * be read, which meant unmuting while the end card was already up re-ran the effect
   * and sounded the ending a second time, minutes after it happened.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!finished) {
      settled.current = false;
      return;
    }
    if (settled.current) return;
    settled.current = true;
    play("settle", muted);
  }, [finished, muted]);

  /**
   * A fill lands: wash the chart, float the number.
   *
   * Keyed off the bar index rather than the clock, so scrubbing to a bar replays its
   * fills and a paused chart stays still. The unit is the LABEL, not the fill: a TWAP
   * puts twenty slices in one bar, and twenty numbers climbing the screen together say
   * less than two do — so a bar's fills are summed per side before anything is shown.
   *
   * A new fill pushes the previous one OUT rather than stacking on it. At eight times
   * speed a busy wallet lands fills faster than a label can finish leaving, and they
   * piled up on top of each other; now the outgoing label fades and keeps drifting from
   * wherever it had got to, which reads as being displaced rather than as two labels
   * fighting.
   */
  useEffect(() => {
    const at = fillsAtBar.get(cursor);
    if (!at || at.length === 0) return;

    const grouped = new Map<string, { isBuy: boolean; liq: boolean; usd: number; sz: number }>();
    for (const f of at) {
      const liq = wasLiquidated(f);
      const key = liq ? "liq" : f.side;
      const held = grouped.get(key) ?? { isBuy: f.side === "B", liq, usd: 0, sz: 0 };
      held.usd += f.sz * f.px;
      held.sz += f.sz;
      grouped.set(key, held);
    }

    const born: Flash[] = [...grouped.values()].map((v, i) => ({
      id: (flashId += 1),
      isBuy: v.isBuy,
      liq: v.liq,
      usd: v.usd,
      px: v.sz > 0 ? v.usd / v.sz : 0,
      slot: i,
      phase: "enter",
      bornAt: 0,
    }));

    /**
     * Spawned on the next frame rather than in the effect body.
     *
     * Adding to state synchronously here is a cascading render — the effect runs as
     * part of the commit that moved the bar, so it would immediately schedule another.
     * It also gives the `enter` phase a frame to be painted from, which is what the
     * transition eases out of.
     */
    let show = 0;
    const raf = requestAnimationFrame(() => {
      const bornAt = Date.now();
      setFlashes((held) => [
        // Whatever is on screen makes way.
        ...held.map((f) => ({ ...f, phase: "out" as const, outAt: bornAt })),
        ...born.map((f) => ({ ...f, bornAt })),
      ]);
      show = requestAnimationFrame(() =>
        setFlashes((held) =>
          held.map((f) => (f.phase === "enter" ? { ...f, phase: "shown" as const } : f)),
        ),
      );
    });

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(show);
    };
  }, [cursor, fillsAtBar, wasLiquidated]);

  /**
   * Labels retire themselves, on a clock of their own.
   *
   * Driven off each label's own birth time rather than a timeout in the spawn effect,
   * whose cleanup runs on every bar change — so the moment the replay reached a bar
   * with no fills, the pending timer was cancelled and the last label sat there for
   * good. This one leaves on schedule whatever the chart is doing.
   */
  useEffect(() => {
    if (flashes.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setFlashes((held) => {
        let changed = false;
        const next = held.map((f) => {
          if (f.phase !== "shown" || now - f.bornAt < FLASH_MS) return f;
          changed = true;
          return { ...f, phase: "out" as const, outAt: now };
        });
        // Returning the same array when nothing expired keeps this from re-rendering
        // the chart every tick.
        return changed ? next : held;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [flashes.length]);

  /* ----------------------------------------------------------- the clock */

  /** Mirrors `cursor` so the animation loop can read it without restarting each frame. */
  const cursorRef = useRef(0);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    if (!playing || bars === 0) return;
    /**
     * No short-circuit for a cursor already on the last bar: pressing play there runs
     * that bar's own step, so the final candle forms like every other before the card
     * lands, instead of the replay ending on a jump.
     */

    let raf = 0;
    let previous = performance.now();
    /** Time spent inside the CURRENT bar, which is what makes it form. */
    let acc = 0;

    const last = bars - 1;

    const frame = (now: number) => {
      acc += (now - previous) * speed;
      previous = now;

      let c = cursorRef.current;
      // A bar at a time, so a long frame crosses several without skipping any.
      while (c < last && acc >= STEP_MS) {
        acc -= STEP_MS;
        c += 1;
      }

      /**
       * The final bar forms like every other one.
       *
       * It used to be painted straight to its close the instant the cursor reached it and
       * the loop stopped in the same frame, so a replay ended on a jump: the last candle
       * snapped to full height with no growth and the card landed on top of it. Letting its
       * own step run means the trade finishes at the same pace it was watched at.
       */
      paintTo(c, Math.min(1, acc / STEP_MS));
      soundTo(c);

      if (c !== cursorRef.current) {
        cursorRef.current = c;
        setCursor(c);
      }

      if (c >= last && acc >= STEP_MS) {
        setPlaying(false);
        setFinished(true);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, bars, paintTo, soundTo]);

  const done = finished;

  const restart = useCallback(() => {
    unlock();
    cursorRef.current = 0;
    setCursor(0);
    setFinished(false);
    setFlashes([]);
    paintedRef.current = -1;
    soundedRef.current = -1;
    milestoneRef.current = 0;
    setPlaying(true);
  }, []);

  const toggle = useCallback(() => {
    unlock();
    if (done) restart();
    else setPlaying((p) => !p);
  }, [done, restart]);

  const step = useCallback(
    (bars5: number) => {
      setPlaying(false);
      setFinished(false);
      setCursor((c) => Math.min(Math.max(0, c + bars5 * 5), bars - 1));
    },
    [bars],
  );

  const toggleMute = useCallback(() => {
    const next = !readMuted();
    writeMuted(next);
    window.dispatchEvent(new Event("runback-mute"));
    if (!next) play("buy", false);
  }, []);

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setFinished(false);
        setCursor((c) => Math.max(0, c - (e.shiftKey ? 25 : 5)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setFinished(false);
        setCursor((c) => Math.min(bars - 1, c + (e.shiftKey ? 25 : 5)));
      } else if (e.key.toLowerCase() === "m") {
        toggleMute();
      } else if (e.key.toLowerCase() === "r") {
        restart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, toggleMute, restart, bars, onClose]);

  /* -------------------------------------------------------------- render */

  const point = data.points[Math.min(cursor, data.points.length - 1)] ?? null;
  const total = done ? data.net : (point?.total ?? 0);
  const held = duration(data.candles[bars - 1]!.t - data.candles[0]!.t);
  const sideTone = data.side === "LONG" ? UP : data.side === "SHORT" ? DOWN : ACCENT;

  const shownFills = useMemo(() => {
    if (data.fills.length <= MAX_FILL_ROWS) return data.fills;
    return [...data.fills]
      .sort((a, b) => b.sz * b.px - a.sz * a.px)
      .slice(0, MAX_FILL_ROWS)
      .sort((a, b) => a.time - b.time);
  }, [data.fills]);

  return (
    <div className="hl-fade flex flex-col gap-3" onPointerDown={() => unlock()}>
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_272px]">
        {/* --------------------------------------------------- chart column */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel flush className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="rb-press inline-flex h-11 items-center text-mini text-muted hover:text-tx"
                  >
                    ← Positions
                  </button>
                )}
                <CoinIcon coin={data.coin} label={data.label} size={20} />
                <span className="text-lead leading-none text-title">{data.label}</span>
                <span
                  className="text-micro tracking-[0.08em]"
                  style={{ color: sideTone }}
                >
                  {data.side}
                </span>
                <span className="inline-flex items-center gap-1.5 text-mini text-faint">
                  <VenueMark id={data.venue} size={14} />
                  {data.venueName}
                </span>
                {data.closedByLiquidation && (
                  <span className="rounded-[4px] bg-loss/15 px-1.5 py-0.5 text-micro tracking-[0.08em] text-loss">
                    LIQUIDATED
                  </span>
                )}
                {data.open && (
                  <span className="rounded-[4px] border border-border px-1.5 py-0.5 text-micro tracking-[0.08em] text-faint">
                    OPEN
                  </span>
                )}
                <span className="hidden text-mini text-faint sm:inline">
                  {held} · {bars} × {data.interval}
                </span>
              </div>

              <div className="flex items-baseline gap-2.5">
                <span className="text-micro tracking-[0.08em] text-faint">PNL</span>
                <span
                  className="text-head leading-none tabular-nums"
                  style={{ color: total >= 0 ? UP : DOWN }}
                >
                  {signedUsd(total)}
                </span>
              </div>
            </div>

            {data.venue === "jupiter" && (
              <p className="border-b border-white/5 px-4 py-2 text-mini text-faint">
                Fills are Jupiter&apos;s. Bars are Hyperliquid&apos;s book for the same asset.
              </p>
            )}

            <div className="relative">
              <div ref={priceRef} className="h-[360px] w-full sm:h-[460px]" />

              {/*
                A fill announcing itself: the chart washes in the fill's colour and a large
                label floats at the top centre, where the
                price action — which sits in the lower two thirds — is not covered.
                A new fill displaces the last; nothing stacks.
              */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {/* Only an arriving fill washes the chart. Leaving ones would stack
                    their gradients and hold the screen bright. */}
                {(() => {
                  const arriving = flashes.filter((f) => f.phase !== "out");
                  // Only a bar carrying both signs needs separating; one that does not
                  // stays centred, so the ordinary fill looks untouched.
                  const split =
                    arriving.some((f) => f.isBuy) && arriving.some((f) => !f.isBuy);
                  return arriving.map((f) => (
                    <div
                      key={f.id}
                      className="replay-wash absolute inset-0"
                      style={{
                        background: `radial-gradient(ellipse at ${
                          split ? (f.isBuy ? "right" : "left") : "center"
                        }, ${
                          f.liq
                            ? "rgba(151,252,228,0.20)"
                            : f.isBuy
                              ? "rgba(80,210,193,0.20)"
                              : "rgba(237,112,136,0.20)"
                        }, transparent 70%)`,
                      }}
                    />
                  ));
                })()}
                {flashes.map((f) => (
                  <div
                    key={`t${f.id}`}
                    onTransitionEnd={(e) => {
                      if (e.propertyName !== "opacity" || f.phase !== "out") return;
                      setFlashes((held) => held.filter((x) => x.id !== f.id));
                    }}
                    style={{
                      left: "50%",
                      top: 34 + f.slot * 42,
                      opacity: f.phase === "shown" ? 1 : 0,
                      transform:
                        f.phase === "enter"
                          ? "translate(-50%, 14px) scale(0.94)"
                          : f.phase === "shown"
                            ? "translate(-50%, 0) scale(1)"
                            : "translate(-50%, -30px) scale(1)",
                      color: f.liq ? ACCENT : f.isBuy ? UP : DOWN,
                    }}
                    className="replay-flash absolute whitespace-nowrap text-[22px] font-semibold leading-none tracking-[-0.02em]"
                  >
                    {f.liq
                      ? `LIQUIDATED ${usdCompact(f.usd)}`
                      : `${usdCompact(f.usd)} ${f.isBuy ? "BUY" : "SELL"}`}
                    <span className="ml-2 text-[15px] font-bold text-muted">
                      @ {price(f.px)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pointer-events-none absolute bottom-3 left-3 text-mini text-faint">
                {point && Math.abs(point.qty) > 1e-9
                  ? `${size(Math.abs(point.qty))} @ ${price(data.avgEntry)}`
                  : "flat"}
              </div>

              {done && (
                /**
                 * The end card, which is what a clip is actually for.
                 *
                 * It used to be the net figure and a percentage under it. That is a
                 * receipt, not an ending: the whole point of watching the drawdown is
                 * knowing what it cost to sit through, and none of that survived to the
                 * last frame. Return, held, best and worst all land here now.
                 */
                <div className="hl-fade pointer-events-none absolute inset-0 flex items-center justify-center bg-ground/80 backdrop-blur-[2px]">
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-micro tracking-[0.12em] text-faint">
                      {data.closedByLiquidation ? "LIQUIDATED" : "CLOSED"}
                    </span>

                    <div className="flex items-baseline gap-3">
                      <span
                        className="text-hero leading-none tabular-nums"
                        style={{ color: data.net >= 0 ? UP : DOWN }}
                      >
                        {signedUsd(data.net)}
                      </span>
                      {data.roe !== null && (
                        <span
                          className="text-head leading-none tabular-nums"
                          style={{ color: data.roe >= 0 ? UP : DOWN }}
                        >
                          {pct(data.roe)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-5 text-mini text-muted">
                      <span>
                        <span className="text-faint">held </span>
                        {held}
                      </span>
                      <span>
                        <span className="text-faint">peak </span>
                        <span style={{ color: UP }}>{signedUsd(data.peak)}</span>
                      </span>
                      <span>
                        <span className="text-faint">drawdown </span>
                        <span style={{ color: DOWN }}>{signedUsd(data.trough)}</span>
                      </span>
                      <span>
                        <span className="text-faint">fees </span>
                        {signedUsd(-data.fees)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ------------------------------------------------- transport */}
            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-4 py-3">
              <div className="flex items-center gap-0.5 rounded-full border border-white/8 bg-inset/30 p-1">
                <Ctl onClick={restart} label="Restart" hint="R">
                  <SkipIcon />
                </Ctl>
                <Ctl onClick={() => step(-1)} label="Back 5 bars" hint="&larr;">
                  <StepIcon />
                </Ctl>
                <Ctl onClick={toggle} label={playing ? "Pause" : "Play"} hint="Space" primary>
                  {playing && !done ? <PauseIcon /> : <PlayIcon />}
                </Ctl>
                <Ctl onClick={() => step(1)} label="Forward 5 bars" hint="&rarr;">
                  <StepIcon forward />
                </Ctl>
              </div>

              {/*
                A segmented control, sized as one object.
                Four independently-padded pills gave four different widths, because "0.5x"
                is three glyphs and "1x" is two, so the group read as broken alignment
                rather than as a control. Equal columns and a single track fix it.
              */}
              <div
                role="group"
                aria-label="Playback speed"
                className="grid h-11 grid-cols-4 items-stretch overflow-hidden rounded-full border border-white/8 bg-inset/30 p-[3px]"
              >
                {SPEEDS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSpeed(sp)}
                    aria-pressed={speed === sp}
                    className={`rb-press min-w-11 rounded-full text-mini leading-none ${
                      speed === sp
                        ? "bg-mint-soft text-mint-text"
                        : "text-faint hover:text-tx"
                    }`}
                  >
                    {sp}&times;
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={toggleMute}
                title={muted ? "Unmute (M)" : "Mute (M)"}
                aria-label={muted ? "Unmute" : "Mute"}
                className={`rb-press grid size-11 place-items-center rounded-full border border-white/8 hover:border-white/16 ${
                  muted ? "text-faint" : "text-mint"
                }`}
              >
                <SpeakerIcon muted={muted} />
              </button>

              <input
                type="range"
                min={0}
                max={Math.max(0, bars - 1)}
                value={cursor}
                onChange={(e) => {
                  setPlaying(false);
                  setFinished(false);
                  setCursor(Number(e.target.value));
                }}
                className="h-1 min-w-[110px] flex-1 accent-[#97fce4]"
                aria-label="Scrub"
              />

              <span className="shrink-0 text-mini tabular-nums text-faint">
                {clock(data.candles[Math.min(cursor, bars - 1)]!.t)}
                <span className="text-micro"> / {clock(data.candles[bars - 1]!.t)}</span>
              </span>
            </div>
          </Panel>

          <Panel
            label="RUNNING PNL"
            aside={
              <span className="text-faint">
                {signedUsd(data.peak)} / {signedUsd(data.trough)}
              </span>
            }
            flush
          >
            <div ref={pnlRef} className="h-[92px] w-full" />
          </Panel>
        </div>

        {/* ----------------------------------------------------- right rail */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel label="POSITION" flush>
            <dl className="flex flex-col">
              <Row label="Realized" value={signedUsd(data.realized)} tone={data.realized} />
              <Row label="Fees" value={`−$${data.fees.toFixed(2)}`} />
              <Row label="Net" value={signedUsd(data.net)} tone={data.net} />
              <Row
                label="Return"
                value={data.roe === null ? "–" : pct(data.roe)}
                tone={data.roe ?? undefined}
              />
              <Row label="Entry" value={price(data.avgEntry)} />
              <Row label="Held" value={held} />
              <Row label="Fills" value={String(data.fills.length)} />
            </dl>
          </Panel>

          <Export data={data} speed={speed} />
        </div>
      </div>

      {/* ------------------------------------------------------------ fills */}
      <Panel
        label="FILLS"
        aside={
          <span className="text-faint">
            {data.fills.length > MAX_FILL_ROWS
              ? `${MAX_FILL_ROWS} of ${data.fills.length}, largest first`
              : data.fills.length}
          </span>
        }
        flush
      >
        <div className="scrollers max-h-[260px] overflow-auto">
          <table className="w-full min-w-[520px] border-collapse text-mini">
            <tbody>
              {shownFills.map((f) => (
                <tr key={f.tid} className="border-b border-divider last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-faint">{clock(f.time)}</td>
                  <td
                    className="whitespace-nowrap px-3 py-2"
                    style={{ color: wasLiquidated(f) ? ACCENT : f.side === "B" ? UP : DOWN }}
                  >
                    {wasLiquidated(f) ? "LIQ " : ""}
                    {f.dir}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">{size(f.sz)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">{price(f.px)}</td>
                  <td
                    className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
                    style={{
                      color: f.closedPnl === 0 ? "#9aa3a48c" : f.closedPnl > 0 ? UP : DOWN,
                    }}
                  >
                    {f.closedPnl === 0 ? "–" : signedUsd(f.closedPnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const color = tone === undefined ? "#f6fefd" : tone >= 0 ? UP : DOWN;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider px-3 py-2 last:border-b-0">
      <dt className="text-mini text-faint">{label}</dt>
      <dd className="text-body tabular-nums" style={{ color }}>
        {value}
      </dd>
    </div>
  );
}

/**
 * One transport button.
 *
 * The tooltip carries both the action and its key, so the keyboard shortcuts are
 * discoverable from the control itself rather than from a line of text under the chart
 * that everybody scrolls past.
 */
function Ctl({
  onClick,
  label,
  hint,
  primary,
  children,
}: {
  onClick: () => void;
  label: string;
  hint: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (${hint})`}
      aria-label={label}
      className={`rb-press grid size-11 place-items-center rounded-full ${
        primary
          ? "w-12 bg-mint-soft text-mint-text hover:brightness-105"
          : "text-muted hover:bg-inset hover:text-tx"
      }`}
    >
      {children}
    </button>
  );
}

const ICON = {
  className: "h-[12px] w-[12px]",
  fill: "currentColor",
  "aria-hidden": true,
} as const;

function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" {...ICON}>
      <path d="M3.4 1.9a.6.6 0 0 1 .93-.5l5 4.1a.6.6 0 0 1 0 1l-5 4.1a.6.6 0 0 1-.93-.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" {...ICON}>
      <rect x="2.6" y="1.8" width="2.6" height="8.4" rx="1.1" />
      <rect x="6.8" y="1.8" width="2.6" height="8.4" rx="1.1" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg viewBox="0 0 12 12" {...ICON}>
      <rect x="1.7" y="1.8" width="1.9" height="8.4" rx="0.95" />
      <path d="M10.4 2.2a.6.6 0 0 1 .9.5v6.6a.6.6 0 0 1-.9.5L5.2 6.5a.6.6 0 0 1 0-1z" />
    </svg>
  );
}

function StepIcon({ forward }: { forward?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" {...ICON} style={forward ? undefined : { transform: "scaleX(-1)" }}>
      <path d="M1.9 2.2a.6.6 0 0 0-.9.5v6.6a.6.6 0 0 0 .9.5l4.4-3.3a.6.6 0 0 0 0-1z" />
      <path d="M6.6 2.2a.6.6 0 0 0-.9.5v6.6a.6.6 0 0 0 .9.5l4.4-3.3a.6.6 0 0 0 0-1z" />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[13px] w-[13px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6.2h2.2L8.4 3.6v8.8L5.2 9.8H3z" />
      {muted ? (
        <path d="M10.8 6.4l3 3.2M13.8 6.4l-3 3.2" />
      ) : (
        <>
          <path d="M10.8 6.1a2.6 2.6 0 0 1 0 3.8" />
          <path d="M12.6 4.6a5 5 0 0 1 0 6.8" />
        </>
      )}
    </svg>
  );
}

/**
 * The export panel.
 *
 * Not a single download button: the shape has to be chosen before anything renders,
 * because the clip is built at the target size rather than recorded and cropped. A 9:16
 * clip is not a 16:9 one with the sides taken off. The type scales differently and the
 * fill labels move to the other edge of the chart.
 */
function Export({ data, speed }: { data: ReplayData; speed: number }) {
  const [shape, setShape] = useState<Shape>("landscape");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  /**
   * A clip runs exactly as long as the replay does at the current speed — every bar
   * held the same time — so the estimate is arithmetic, and a trade that would run
   * past the ceiling is refused up front rather than smeared to fit. Raising the
   * speed is how it fits, which is the practical answer to the same wall.
   */
  const seconds = (data.candles.length * STEP_MS) / speed / 1000 + OUTRO_SECONDS;
  const tooLong = seconds > MAX_CLIP_SECONDS;

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    setProgress(0);
    cancelled.current = false;
    try {
      const out = await exportClip(data, {
        shape,
        speed,
        onProgress: setProgress,
        cancelled: () => cancelled.current,
      });
      if (out) save(out.blob, out.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }, [data, shape, speed]);

  return (
    <Panel label="EXPORT">
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-0.5 rounded-full border border-white/8 bg-inset/30 p-1">
          {(Object.keys(FORMATS) as Shape[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShape(s)}
              disabled={busy}
              aria-pressed={shape === s}
              className={`rb-press min-h-11 rounded-full py-2 text-mini font-medium ${
                shape === s ? "bg-mint-soft text-mint-text" : "text-faint hover:text-tx"
              }`}
            >
              {FORMATS[s].label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={busy ? () => (cancelled.current = true) : run}
          disabled={!busy && tooLong}
          aria-label={busy ? "Cancel export" : "Export MP4"}
          className="rb-press h-11 rounded-full bg-mint-soft text-body font-medium text-mint-text hover:brightness-110"
        >
          {busy ? `Cancel · ${Math.round(progress * 100)}%` : "Export MP4"}
        </button>

        {busy ? (
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-inset">
            <div
              className="h-full bg-mint transition-[width] duration-150"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        ) : (
          <p className="text-micro text-faint">
            {FORMATS[shape].w}&times;{FORMATS[shape].h} · ~{Math.round(seconds)}s at{" "}
            {speed}&times;
          </p>
        )}

        {tooLong && !busy && (
          <p className="text-mini text-mint">
            That clip would run ~{Math.round(seconds)}s, past the {MAX_CLIP_SECONDS}s
            ceiling — raise the replay speed and it will fit.
          </p>
        )}

        {error && <p className="text-mini text-loss">{error}</p>}
      </div>
    </Panel>
  );
}
