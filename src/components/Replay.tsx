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
 * How long the replay runs, in ms, regardless of how many bars it holds.
 *
 * Derived rather than a fixed rate per bar, which is what the first version did. At 90ms a
 * bar a 45-bar scalp was a four-second video and an 800-bar hold was seventy seconds: the
 * same control produced two completely different things. Pacing from the duration means
 * every replay is watchable in about the same sitting and the speed control means what it
 * says.
 */
const RUN_MS = 14_000;
const MIN_STEP_MS = 16;
const MAX_STEP_MS = 150;

const SPEEDS = [0.5, 1, 2, 4] as const;

/** Every $500 gained past the previous high sounds once. */
const PROFIT_STEP = 500;

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
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [muted, setMuted] = useState(true);

  const bars = data.candles.length;
  const stepMs = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, RUN_MS / Math.max(bars, 1)));

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

  const allMarkers = useMemo<SeriesMarker<Time>[]>(
    () =>
      data.fills.map((f) => ({
        time: (data.candles[Math.max(0, barOf(f.time))]!.t / 1000) as UTCTimestamp,
        position: f.side === "B" ? "belowBar" : "aboveBar",
        color: f.liquidation ? ACCENT : f.side === "B" ? UP : DOWN,
        shape: f.side === "B" ? "arrowUp" : "arrowDown",
        text: f.liquidation ? "LIQ" : "",
      })),
    [data.fills, data.candles, barOf],
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
      grid: { vertLines: { color: "transparent" }, horzLines: { color: "#ffffff08" } },
      rightPriceScale: { borderColor: BORDER, scaleMargins: { top: 0.14, bottom: 0.14 } },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
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
      priceLineVisible: false,
      lastValueVisible: false,
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

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || bars === 0) return;

    const upto = Math.min(cursor, bars - 1);

    /**
     * Append when the cursor moved forward by one, reset otherwise.
     *
     * `setData` every frame re-fits the whole series and made the price scale twitch on
     * every bar. Appending leaves it alone, which is what makes playback look like a chart
     * advancing rather than one being redrawn.
     */
    if (upto === paintedRef.current + 1) {
      series.update(candleData[upto]!);
    } else if (upto !== paintedRef.current) {
      series.setData(candleData.slice(0, upto + 1));
      // The whole span stays in view, so the trade holds still and fills in.
      chart.timeScale().setVisibleRange({
        from: candleData[0]!.time,
        to: candleData[candleData.length - 1]!.time,
      });
    }
    paintedRef.current = upto;

    const cutoff = data.candles[upto]!.t;
    markersRef.current?.setMarkers(
      allMarkers.filter((m) => (m.time as number) * 1000 <= cutoff),
    );
    pnlSeriesRef.current?.setData(pnlData.slice(0, upto + 1));
  }, [cursor, bars, candleData, pnlData, allMarkers, data.candles]);

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
        play(f.liquidation ? "liquidation" : f.side === "B" ? "buy" : "sell", muted);
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
  }, [cursor, bars, fillsAtBar, muted, data.points]);

  /* ----------------------------------------------------------- the clock */

  useEffect(() => {
    if (!playing || bars === 0) return;
    if (cursor >= bars - 1) {
      setPlaying(false);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = stepMs / speed;

    const frame = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= step) {
        const advance = Math.floor(acc / step);
        acc -= advance * step;
        setCursor((c) => Math.min(c + advance, bars - 1));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, bars, cursor, stepMs]);

  const done = cursor >= bars - 1;

  const restart = useCallback(() => {
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, toggleMute, bars]);

  /* -------------------------------------------------------------- render */

  const point = data.points[Math.min(cursor, data.points.length - 1)] ?? null;
  const total = done ? data.net : (point?.total ?? 0);
  const held = duration(data.candles[bars - 1]!.t - data.candles[0]!.t);
  const sideTone = data.side === "LONG" ? UP : data.side === "SHORT" ? DOWN : ACCENT;

  const recent = useMemo(() => {
    const out: {
      key: string;
      isBuy: boolean;
      liq: boolean;
      dir: string;
      usd: number;
      px: number;
    }[] = [];
    for (let b = Math.max(0, cursor - Math.ceil(bars / 24)); b <= cursor; b += 1) {
      for (const f of fillsAtBar.get(b) ?? []) {
        out.push({
          key: String(f.tid),
          isBuy: f.side === "B",
          liq: f.liquidation,
          dir: f.dir,
          usd: f.sz * f.px,
          px: f.px,
        });
      }
    }
    return out.slice(-2);
  }, [cursor, bars, fillsAtBar]);

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
                {data.liquidated && (
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
                      {data.liquidated ? "LIQUIDATED" : "CLOSED"}
                    </span>
                    <span
                      className="text-[44px] leading-none"
                      style={{ color: data.net >= 0 ? UP : DOWN }}
                    >
                      {signedUsd(data.net)}
                    </span>
                    <span className="text-[12px] text-muted">
                      {pct(data.roe)} · fees {signedUsd(-data.fees)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ------------------------------------------------- transport */}
            <div className="flex flex-wrap items-center gap-2.5 border-t border-border px-3 py-2.5">
              <button
                onClick={toggle}
                className="h-[28px] rounded-[8px] bg-accent-soft px-4 text-[11px] text-accent-text transition-[filter,transform] duration-[120ms] hover:brightness-105 active:scale-[0.99]"
              >
                {done ? "Run it back" : playing ? "Pause" : "Play"}
              </button>

              <div className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`rounded-[6px] px-2 py-0.5 text-[11px] transition-colors duration-[120ms] ${
                      speed === s ? "bg-inset text-tx" : "text-faint hover:text-muted"
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>

              <button
                onClick={toggleMute}
                title="Mute (M)"
                aria-label={muted ? "Unmute" : "Mute"}
                className={`grid h-[28px] w-[28px] place-items-center rounded-[8px] border border-border transition-colors duration-[120ms] hover:border-muted ${
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
                className="h-1 min-w-[120px] flex-1 accent-[#97fce4]"
                aria-label="Scrub"
              />

              <span className="w-[40px] shrink-0 text-right text-[11px] text-faint">
                {clock(data.candles[Math.min(cursor, bars - 1)]!.t)}
              </span>
            </div>
          </Panel>

          <Panel
            label="RUNNING PNL"
            aside={
              <span className="text-faint">
                best {signedUsd(data.peak)} · worst {signedUsd(data.trough)}
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
              <Row label="Return" value={pct(data.roe)} tone={data.roe} />
              <Row label="Entry" value={price(data.avgEntry)} />
              <Row label="Held" value={held} />
              <Row label="Fills" value={String(data.fills.length)} />
            </dl>
          </Panel>

          <Export data={data} />

          {data.truncatedStart && (
            <p className="rounded-[8px] border border-accent/30 bg-accent/5 px-3 py-2.5 text-[11px] leading-relaxed text-accent">
              Already open when the window began, so the entries are off the chart. The exit
              is exact; the running total before it is not.
            </p>
          )}

          <p className="px-1 text-[10px] leading-relaxed text-faint">
            Space to play · arrows to scrub · M to mute
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------ fills */}
      <Panel label="FILLS" aside={<span className="text-faint">{data.fills.length}</span>} flush>
        <div className="scrollers max-h-[260px] overflow-auto">
          <table className="w-full min-w-[520px] border-collapse text-[11px]">
            <tbody>
              {data.fills.map((f) => (
                <tr key={f.tid} className="border-b border-divider last:border-b-0">
                  <td className="px-3 py-2 text-faint">{clock(f.time)}</td>
                  <td
                    className="px-3 py-2"
                    style={{ color: f.liquidation ? ACCENT : f.side === "B" ? UP : DOWN }}
                  >
                    {f.liquidation ? "LIQ " : ""}
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
            {FORMATS[shape].w}×{FORMATS[shape].h}, rendered in your browser
          </p>
        )}

        {error && <p className="text-[11px] text-error">{error}</p>}
      </div>
    </Panel>
  );
}
