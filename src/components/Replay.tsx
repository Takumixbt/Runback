"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Replay as ReplayData } from "@/lib/episodes";
import { exportClip, FORMATS, type Shape } from "@/lib/export";
import { save } from "@/lib/record";
import { play, readMuted, writeMuted } from "@/lib/sound";
import { clock, duration, pct, price, shortAddress, signedUsd, size } from "@/lib/format";
import { CoinIcon } from "./CoinIcon";
import { Panel } from "./Panel";

const GROUND = "#0f1a1e";
const BORDER = "#273035";
const MUTED = "#9aa3a4";
const UP = "#50d2c1";
const DOWN = "#ed7088";
const ACCENT = "#97fce4";

/**
 * How long one bar is held at 1x.
 *
 * Six hundred milliseconds, which is Trickshot's number, and it is the single thing that
 * decides whether a replay is watchable. Normalising the whole thing to a fixed total
 * duration was the mistake: it meant a four-hundred-bar hold ran at fifty milliseconds a
 * bar, so the candles blurred past and nothing could be read. A bar deserves the same time
 * whatever else is in the chart, and anyone who wants it faster has the speed control.
 */
const STEP_MS = 600;

/**
 * How much longer a bar carrying a fill is held, and how far that spreads either side.
 *
 * The whole point of watching a trade rather than reading its number is the moment the
 * entry lands and the moment it comes off, and a uniform bar rate spends exactly as long
 * on those as on the hour of nothing before them. Short positions suffered worst: forty
 * bars at a flat rate is over before it registers.
 *
 * So quiet stretches move, and the replay slows into every fill and slows hardest into a
 * liquidation. The total is normalised afterwards, so this changes the SHAPE of the
 * playback without making it longer.
 */
const FILL_BOOST = 1.6;
const LIQ_BOOST = 3;

/**
 * Bars kept in view while the replay runs, and the gap held open ahead of the last one.
 *
 * Wide enough to carry the shape of a move, tight enough that a candle is a candle rather
 * than a hair. Anything shorter than this is shown whole and does not scroll.
 *
 * The count is the only thing deciding how big a candle looks, so it is deliberately low.
 * Fitting an entire trade into the panel is what made them read as slivers.
 */
const WINDOW_BARS = 95;
const RIGHT_PAD = 6;

const SPEEDS = [1, 2, 4, 8] as const;

/** Every $500 gained past the previous high sounds once. */
const PROFIT_STEP = 500;

/**
 * Rows the fill table will render.
 *
 * A TWAP'd position can carry a thousand fills. Rendering all of them costs a thousand DOM
 * nodes to show a list nobody scrolls to the bottom of, so the biggest are kept and the
 * header says what was left out.
 */
const MAX_FILL_ROWS = 150;

export function Replay({ data }: { data: ReplayData }) {
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
  const [playing, setPlaying] = useState(true);
  /** Two, like Trickshot: one is deliberate, and deliberate is slow to arrive at. */
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
  const [muted, setMuted] = useState(true);

  const bars = data.candles.length;
  /** Lowercased once: every fill compares against it to attribute a forced close. */
  const me = data.wallet.toLowerCase();
  const wasLiquidated = useCallback(
    (f: { liquidatedUser: string | null }) => f.liquidatedUser === me,
    [me],
  );


  useEffect(() => setMuted(readMuted()), []);

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
  }, [data.fills, barOf]);

  /**
   * One marker per BAR, not one per fill, and a running count so a frame can slice.
   *
   * Both halves of this are performance fixes for the same case: a position built out of a
   * TWAP or a swept market order. MEASURED on a HIP-3 market maker, one position carried
   * 911 fills. That meant 911 arrows stacked on a few hundred bars, which is unreadable,
   * and `allMarkers.filter(...)` running over all 911 on every animation frame, which is
   * what made the replay crawl.
   *
   * Merging by bar fixes the picture: twenty slices at the same minute were one decision
   * and should be one arrow, sized by the total. `upto` then turns the per-frame filter
   * into a slice of a pre-sorted array, so the cost stops scaling with fill count.
   */
  const { markers: allMarkers, upto: markersUpto } = useMemo(() => {
    const byBar = new Map<number, { buy: number; sell: number; liq: boolean; n: number }>();
    for (const f of data.fills) {
      const b = Math.max(0, barOf(f.time));
      const cell = byBar.get(b) ?? { buy: 0, sell: 0, liq: false, n: 0 };
      if (f.side === "B") cell.buy += f.sz * f.px;
      else cell.sell += f.sz * f.px;
      if (wasLiquidated(f)) cell.liq = true;
      cell.n += 1;
      byBar.set(b, cell);
    }

    const bars = [...byBar.keys()].sort((a, b) => a - b);
    const markers: SeriesMarker<Time>[] = bars.map((b) => {
      const cell = byBar.get(b)!;
      const isBuy = cell.buy >= cell.sell;
      return {
        time: (data.candles[b]!.t / 1000) as UTCTimestamp,
        position: isBuy ? "belowBar" : "aboveBar",
        color: cell.liq ? ACCENT : isBuy ? UP : DOWN,
        shape: isBuy ? "arrowUp" : "arrowDown",
        text: cell.liq ? "LIQ" : "",
      };
    });

    /** How many markers exist at or before each bar, so a frame is a slice not a scan. */
    const upto = new Int32Array(data.candles.length);
    let k = 0;
    for (let i = 0; i < data.candles.length; i += 1) {
      while (k < bars.length && bars[k]! <= i) k += 1;
      upto[i] = k;
    }
    return { markers, upto };
  }, [data.fills, data.candles, barOf, wasLiquidated]);

  /**
   * How long each bar is held, in ms. Slow motion, precomputed.
   *
   * Weights rise near any bar that carries a fill and rise further near a forced close,
   * falling away over a spread that scales with the chart so it reads the same on forty
   * bars as on twelve hundred. The weights are then scaled so the whole replay lands on a
   * target duration, which means the emphasis costs nothing in total length.
   */
  const dwell = useMemo(() => {
    const out = new Float32Array(Math.max(bars, 1)).fill(1);
    if (bars === 0) return out;

    const spread = Math.max(2, Math.round(bars / 45));
    for (const [bar, at] of fillsAtBar) {
      const boost = at.some(wasLiquidated) ? LIQ_BOOST : FILL_BOOST;
      for (let d = -spread; d <= spread; d += 1) {
        const i = bar + d;
        if (i < 0 || i >= bars) continue;
        // Cosine falloff: no seam where the emphasis starts and stops.
        const fall = 0.5 * (1 + Math.cos((Math.PI * d) / (spread + 1)));
        out[i] = Math.max(out[i]!, 1 + boost * fall);
      }
    }

    for (let i = 0; i < bars; i += 1) out[i] = out[i]! * STEP_MS;
    return out;
  }, [bars, fillsAtBar, wasLiquidated]);

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
        rightOffset: 0,
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

    /**
     * The window is sized once, here, and then left alone.
     *
     * A short replay is framed whole. A long one opens on a window of WINDOW_BARS and the
     * chart scrolls itself from there, which keeps a candle the width of a candle instead
     * of squeezing the entire trade into the panel.
     */
    chart.timeScale().setVisibleLogicalRange(
      candleData.length <= WINDOW_BARS
        ? { from: -RIGHT_PAD / 2, to: candleData.length - 1 + RIGHT_PAD / 2 }
        : { from: -RIGHT_PAD, to: WINDOW_BARS - RIGHT_PAD },
    );

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

      const rewound = i < paintedRef.current;
      if (rewound) {
        // Rebuild, which is the only way to remove bars from a series.
        series.setData(candleData.slice(0, i + 1));
      } else {
        // Fill in whole bars for anything skipped, so nothing is left half-drawn.
        for (let k = paintedRef.current + 1; k < i; k += 1) series.update(candleData[k]!);
      }

      /**
       * The bar being lived through, interpolated.
       *
       * Open is fixed; close walks from the open toward the real close, and the wick only
       * extends as far as the body has travelled. Repeatedly updating the SAME timestamp
       * is exactly what `update` is for, so this costs one call a frame.
       */
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

      /**
       * Following is left to the chart, which already knows how.
       *
       * Writing a fractional logical range every frame was the shake: the library resolves
       * a range to whole pixels, so a window nudged by a hundredth of a bar sixty times a
       * second lands on a slightly different pixel grid each time and the whole plot
       * shivers. `shiftVisibleRangeOnNewBar` scrolls by exactly one bar when a bar is
       * appended, which is what every live chart does and what this needed all along.
       *
       * The range is only forced after a rewind, where bars were removed and the window
       * has to be put back where the cursor is.
       */
      if (rewound && bars > WINDOW_BARS) {
        chart.timeScale().setVisibleLogicalRange({
          from: i - WINDOW_BARS + RIGHT_PAD,
          to: i + RIGHT_PAD,
        });
      }

      if (i !== paintedRef.current) {
        markersRef.current?.setMarkers(allMarkers.slice(0, markersUpto[i] ?? 0));
        pnlSeriesRef.current?.setData(pnlData.slice(0, i + 1));
      }
      paintedRef.current = i;
    },
    [bars, candleData, pnlData, allMarkers, markersUpto],
  );

  /**
   * Redraw on anything that is not the animation loop: a scrub, a restart, a fresh chart.
   *
   * `paintedRef` is reset to -1 when the chart is rebuilt, and reading it here would make
   * this effect depend on a ref it cannot observe, so it simply paints the current cursor
   * whole. The loop takes over the moment playback resumes.
   */
  useEffect(() => {
    paintTo(cursor, 1);
  }, [cursor, paintTo]);

  /* --------------------------------------------------------------- sound */

  useEffect(() => {
    if (bars === 0) return;
    const upto = Math.min(cursor, bars - 1);

    // Scrubbing backwards re-arms rather than replaying everything it passes.
    if (upto <= soundedRef.current) {
      soundedRef.current = upto;
      return;
    }

    for (let b = soundedRef.current + 1; b <= upto; b += 1) {
      for (const f of fillsAtBar.get(b) ?? []) {
        play(wasLiquidated(f) ? "liquidation" : f.side === "B" ? "buy" : "sell", muted);
      }
    }
    soundedRef.current = upto;

    const total = data.points[upto]?.total ?? 0;
    const step = Math.floor(total / PROFIT_STEP);
    if (step > milestoneRef.current && total > 0) {
      milestoneRef.current = step;
      play("profit", muted);
    }

    if (upto === bars - 1) play("settle", muted);
  }, [cursor, bars, fillsAtBar, muted, data.points, wasLiquidated]);

  /* ----------------------------------------------------------- the clock */

  /** Mirrors `cursor` so the animation loop can read it without restarting each frame. */
  const cursorRef = useRef(0);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    if (!playing || bars === 0) return;
    if (cursorRef.current >= bars - 1) {
      setPlaying(false);
      return;
    }

    let raf = 0;
    let last = performance.now();
    /** Time spent inside the CURRENT bar, which is what makes it form. */
    let acc = 0;

    const frame = (now: number) => {
      acc += (now - last) * speed;
      last = now;

      let c = cursorRef.current;
      // A bar at a time, so a long frame crosses several without skipping their dwell.
      while (c < bars - 1 && acc >= (dwell[c] ?? 16)) {
        acc -= dwell[c] ?? 16;
        c += 1;
      }

      const held = dwell[c] ?? 16;
      paintTo(c, c >= bars - 1 ? 1 : acc / held);

      if (c !== cursorRef.current) {
        cursorRef.current = c;
        setCursor(c);
      }
      if (c >= bars - 1) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, bars, dwell, paintTo]);

  const done = cursor >= bars - 1;

  const restart = useCallback(() => {
    cursorRef.current = 0;
    setCursor(0);
    paintedRef.current = -1;
    soundedRef.current = -1;
    milestoneRef.current = 0;
    setPlaying(true);
  }, []);

  const toggle = useCallback(() => {
    if (done) restart();
    else setPlaying((p) => !p);
  }, [done, restart]);

  const step = useCallback(
    (bars5: number) => {
      setPlaying(false);
      setCursor((c) => Math.min(Math.max(0, c + bars5 * 5), bars - 1));
    },
    [bars],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      writeMuted(!m);
      // Unmuting plays one tick so it is obvious the sound is now on.
      if (m) play("buy", false);
      return !m;
    });
  }, []);

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setCursor((c) => Math.max(0, c - (e.shiftKey ? 25 : 5)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setCursor((c) => Math.min(bars - 1, c + (e.shiftKey ? 25 : 5)));
      } else if (e.key.toLowerCase() === "m") {
        toggleMute();
      } else if (e.key.toLowerCase() === "r") {
        restart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, toggleMute, restart, bars]);

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

  const recent = useMemo(() => {
    const out: {
      key: string;
      isBuy: boolean;
      liq: boolean;
      dir: string;
      usd: number;
      px: number;
    }[] = [];
    /**
     * Bounded to a short trailing window and stopped as soon as it has enough.
     *
     * Walking back a twenty-fourth of the chart and collecting every fill in it meant a
     * bar holding four hundred TWAP slices built a four-hundred-entry array on every
     * frame, to then throw all but the last two away.
     */
    const from = Math.max(0, cursor - Math.min(24, Math.ceil(bars / 24)));
    for (let b = cursor; b >= from && out.length < 2; b -= 1) {
      const at = fillsAtBar.get(b);
      if (!at) continue;
      for (let i = at.length - 1; i >= 0 && out.length < 2; i -= 1) {
        const f = at[i]!;
        out.push({
          key: String(f.tid),
          isBuy: f.side === "B",
          liq: wasLiquidated(f),
          dir: f.dir,
          usd: f.sz * f.px,
          px: f.px,
        });
      }
    }
    out.reverse();
    return out;
  }, [cursor, bars, fillsAtBar, wasLiquidated]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_272px]">
        {/* --------------------------------------------------- chart column */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel
            label={undefined}
            flush
            className="min-w-0"
          >
            {/* The market header, the way the terminal sits one above its chart. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <CoinIcon coin={data.coin} label={data.label} size={20} />
                <span className="text-[15px] leading-none text-title">{data.label}</span>
                <span
                  className="text-[10px] tracking-[0.08em]"
                  style={{ color: sideTone }}
                >
                  {data.side}
                </span>
                {data.closedByLiquidation && (
                  <span className="rounded-[4px] bg-error/15 px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-error">
                    LIQUIDATED
                  </span>
                )}
                {data.open && (
                  <span className="rounded-[4px] border border-border px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-faint">
                    OPEN
                  </span>
                )}
                <span className="hidden text-[11px] text-faint sm:inline">
                  {shortAddress(data.wallet, 6)} · {held} · {bars} × {data.interval}
                </span>
              </div>

              <div className="flex items-baseline gap-2.5">
                <span className="text-[10px] tracking-[0.08em] text-faint">PNL</span>
                <span
                  className="text-[22px] leading-none tabular-nums"
                  style={{ color: total >= 0 ? UP : DOWN }}
                >
                  {signedUsd(total)}
                </span>
              </div>
            </div>

            <div className="relative">
              <div ref={priceRef} className="h-[330px] w-full sm:h-[420px]" />

              <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
                {recent.map((f) => (
                  <div
                    key={f.key}
                    className="hl-rise rounded-[6px] px-2 py-1 text-[11px] backdrop-blur-[2px]"
                    style={{
                      background: f.liq
                        ? "#97fce41f"
                        : f.isBuy
                          ? "#50d2c11f"
                          : "#ed70881f",
                      color: f.liq ? ACCENT : f.isBuy ? UP : DOWN,
                    }}
                  >
                    {f.liq ? "LIQUIDATED · " : ""}
                    {f.dir} · {signedUsd(f.usd).slice(1)} @ {price(f.px)}
                  </div>
                ))}
              </div>

              <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-faint">
                {point && Math.abs(point.qty) > 1e-9
                  ? `${size(Math.abs(point.qty))} @ ${price(data.avgEntry)}`
                  : "flat"}
              </div>

              {done && (
                <div className="hl-fade pointer-events-none absolute inset-0 flex items-center justify-center bg-ground/70 backdrop-blur-[1px]">
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[10px] tracking-[0.22em] text-faint">
                      {data.closedByLiquidation ? "LIQUIDATED" : "CLOSED"}
                    </span>
                    <span
                      className="text-[44px] leading-none"
                      style={{ color: data.net >= 0 ? UP : DOWN }}
                    >
                      {signedUsd(data.net)}
                    </span>
                    <span className="text-[12px] text-muted">
                      {data.roe === null ? "" : `${pct(data.roe)} · `}fees{" "}
                      {signedUsd(-data.fees)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ------------------------------------------------- transport */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
              {/*
                A transport, in the order a transport goes.
                The old row had one button that changed its own meaning depending on where
                the playhead was, so there was no way to go back to the start without
                dragging the scrubber to zero and guessing. Restart, step, play, step.
              */}
              <div className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5">
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
                className="grid h-[30px] grid-cols-4 items-stretch overflow-hidden rounded-[8px] border border-border"
              >
                {SPEEDS.map((sp) => (
                  <button
                    key={sp}
                    onClick={() => setSpeed(sp)}
                    aria-pressed={speed === sp}
                    className={`w-[36px] text-[11px] leading-none transition-colors duration-[120ms] ${
                      speed === sp
                        ? "bg-inset text-tx"
                        : "text-faint hover:bg-inset/40 hover:text-muted"
                    }`}
                  >
                    {sp}&times;
                  </button>
                ))}
              </div>

              <button
                onClick={toggleMute}
                title={muted ? "Unmute (M)" : "Mute (M)"}
                aria-label={muted ? "Unmute" : "Mute"}
                className={`grid h-[30px] w-[30px] place-items-center rounded-[8px] border border-border transition-colors duration-[120ms] hover:border-muted ${
                  muted ? "text-faint" : "text-accent"
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
                  setCursor(Number(e.target.value));
                }}
                className="h-1 min-w-[110px] flex-1 accent-[#97fce4]"
                aria-label="Scrub"
              />

              <span className="shrink-0 text-[11px] tabular-nums text-faint">
                {clock(data.candles[Math.min(cursor, bars - 1)]!.t)}
                <span className="text-[10px]"> / {clock(data.candles[bars - 1]!.t)}</span>
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

          <Export data={data} />
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
          <table className="w-full min-w-[520px] border-collapse text-[11px]">
            <tbody>
              {shownFills.map((f) => (
                <tr key={f.tid} className="border-b border-divider last:border-b-0">
                  <td className="px-3 py-2 text-faint">{clock(f.time)}</td>
                  <td
                    className="px-3 py-2"
                    style={{ color: wasLiquidated(f) ? ACCENT : f.side === "B" ? UP : DOWN }}
                  >
                    {wasLiquidated(f) ? "LIQ " : ""}
                    {f.dir}
                  </td>
                  <td className="px-3 py-2 text-right text-muted">{size(f.sz)}</td>
                  <td className="px-3 py-2 text-right text-muted">{price(f.px)}</td>
                  <td
                    className="px-3 py-2 text-right"
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
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="text-[12px] tabular-nums" style={{ color }}>
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
      onClick={onClick}
      title={`${label} (${hint})`}
      aria-label={label}
      className={`grid h-[26px] place-items-center rounded-[6px] transition-colors duration-[120ms] ${
        primary
          ? "w-[38px] bg-accent-soft text-accent-text hover:brightness-105"
          : "w-[30px] text-muted hover:bg-inset hover:text-tx"
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
function Export({ data }: { data: ReplayData }) {
  const [shape, setShape] = useState<Shape>("landscape");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    setProgress(0);
    cancelled.current = false;
    try {
      const out = await exportClip(data, {
        shape,
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
  }, [data, shape]);

  return (
    <Panel label="EXPORT">
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-0.5 rounded-[8px] border border-border p-0.5">
          {(Object.keys(FORMATS) as Shape[]).map((s) => (
            <button
              key={s}
              onClick={() => setShape(s)}
              disabled={busy}
              className={`rounded-[6px] py-1 text-[11px] transition-colors duration-[120ms] ${
                shape === s ? "bg-inset text-tx" : "text-faint hover:text-muted"
              }`}
            >
              {FORMATS[s].label}
            </button>
          ))}
        </div>

        <button
          onClick={busy ? () => (cancelled.current = true) : run}
          className="h-[30px] rounded-[8px] border border-border text-[11px] text-tx transition-colors duration-[120ms] hover:border-accent-soft hover:text-accent"
        >
          {busy ? `Cancel · ${Math.round(progress * 100)}%` : "Export MP4"}
        </button>

        {busy ? (
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-inset">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        ) : (
          <p className="text-[10px] text-faint">
            {FORMATS[shape].w}&times;{FORMATS[shape].h}
          </p>
        )}

        {error && <p className="text-[11px] text-error">{error}</p>}
      </div>
    </Panel>
  );
}
