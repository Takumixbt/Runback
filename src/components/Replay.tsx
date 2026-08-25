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
import { clock, duration, pct, price, shortAddress, signedUsd, size } from "@/lib/format";

/** Wall-clock milliseconds one bar occupies at 1x. */
const STEP_MS = 90;
const SPEEDS = [1, 2, 4, 8] as const;

/** How long a fill label hangs on screen after its bar goes past. */
const FLASH_MS = 1800;

const GROUND = "#0b0c0f";
const LINE = "#242830";
const TX = "#e8ecf2";
const TX2 = "#98a2b0";
const TX3 = "#6b7484";
const MINT = "#35d399";
const SIGNAL = "#ff5a5a";
const AMBER = "#ffb224";

interface Flash {
  key: string;
  isBuy: boolean;
  usd: number;
  px: number;
  liquidation: boolean;
  dir: string;
  at: number;
}

export function Replay({ data }: { data: ReplayData }) {
  const priceRef = useRef<HTMLDivElement>(null);
  const pnlRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const pnlChartRef = useRef<IChartApi | null>(null);
  const pnlSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  /** The last index written into the series, so a step can append instead of resetting. */
  const paintedRef = useRef(-1);

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);

  const bars = data.candles.length;

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

  /** Which bar each fill lands on, found rather than computed. */
  const fillsAtBar = useMemo(() => {
    const map = new Map<number, typeof data.fills>();
    for (const f of data.fills) {
      let lo = 0;
      let hi = data.candles.length - 1;
      if (hi < 0) continue;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (data.candles[mid]!.t <= f.time) lo = mid;
        else hi = mid - 1;
      }
      const list = map.get(lo);
      if (list) list.push(f);
      else map.set(lo, [f]);
    }
    return map;
  }, [data.fills, data.candles]);

  const allMarkers = useMemo<SeriesMarker<Time>[]>(
    () =>
      data.fills.map((f) => {
        const bar = data.candles.findLast?.((c) => c.t <= f.time) ?? data.candles[0];
        return {
          time: ((bar?.t ?? f.time) / 1000) as UTCTimestamp,
          position: f.side === "B" ? "belowBar" : "aboveBar",
          color: f.liquidation ? AMBER : f.side === "B" ? MINT : SIGNAL,
          shape: f.side === "B" ? "arrowUp" : "arrowDown",
          text: f.liquidation ? "LIQ" : "",
        } satisfies SeriesMarker<Time>;
      }),
    [data.fills, data.candles],
  );

  /* -------------------------------------------------------------- charts */

  useEffect(() => {
    const el = priceRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: { background: { color: GROUND }, textColor: TX3, fontFamily: "inherit", attributionLogo: false },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: LINE } },
      rightPriceScale: { borderColor: LINE, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: LINE, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: MINT,
      downColor: SIGNAL,
      wickUpColor: MINT,
      wickDownColor: SIGNAL,
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    /**
     * Average entry sits on the chart the whole way through.
     *
     * Without it a viewer has no reference for whether the candle they are watching is
     * above or below where the position was opened, which is the only thing that makes
     * the PnL number legible as it moves.
     */
    if (data.avgEntry > 0) {
      series.createPriceLine({
        price: data.avgEntry,
        color: TX3,
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
  }, [data.avgEntry, candleData]);

  useEffect(() => {
    const el = pnlRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: { background: { color: GROUND }, textColor: TX3, fontFamily: "inherit", attributionLogo: false },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: "transparent" } },
      rightPriceScale: { borderColor: "transparent", scaleMargins: { top: 0.2, bottom: 0.2 } },
      timeScale: { visible: false, borderColor: "transparent" },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    const series = chart.addSeries(LineSeries, {
      color: AMBER,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Zero is the only meaningful reference on a PnL curve.
    series.createPriceLine({
      price: 0,
      color: LINE,
      lineWidth: 1,
      lineStyle: 0,
      axisLabelVisible: false,
      title: "",
    });

    pnlChartRef.current = chart;
    pnlSeriesRef.current = series;

    return () => {
      chart.remove();
      pnlChartRef.current = null;
      pnlSeriesRef.current = null;
    };
  }, [pnlData]);

  /* ------------------------------------------------------------ painting */

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const upto = Math.min(cursor, bars - 1);
    if (upto < 0) return;

    /**
     * Append when the cursor moved forward by one, reset otherwise.
     *
     * Calling `setData` every frame re-fits the whole series and made the price scale
     * twitch on every bar. Appending leaves the scale where it was, which is what makes
     * the playback look like a chart advancing rather than one being redrawn.
     */
    if (upto === paintedRef.current + 1) {
      series.update(candleData[upto]!);
    } else if (upto !== paintedRef.current) {
      series.setData(candleData.slice(0, upto + 1));
      /**
       * Keep the whole span in view from the first frame.
       *
       * Fitting to what has been revealed means the x-axis rescales on every bar and
       * the candles crawl leftwards. Setting the full range once holds the trade still
       * and lets it fill in.
       */
      chart.timeScale().setVisibleRange({
        from: candleData[0]!.time,
        to: candleData[candleData.length - 1]!.time,
      });
    }
    paintedRef.current = upto;

    // Only the fills that have already happened.
    const cutoff = data.candles[upto]!.t;
    markersRef.current?.setMarkers(
      allMarkers.filter((m) => (m.time as number) * 1000 <= cutoff),
    );

    pnlSeriesRef.current?.setData(pnlData.slice(0, upto + 1));
  }, [cursor, bars, candleData, pnlData, allMarkers, data.candles]);

  /* ----------------------------------------------------------- the clock */

  useEffect(() => {
    if (!playing) return;
    if (cursor >= bars - 1) {
      setPlaying(false);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = STEP_MS / speed;

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
  }, [playing, speed, bars, cursor]);

  const restart = useCallback(() => {
    setCursor(0);
    paintedRef.current = -1;
    setPlaying(true);
  }, []);

  /* -------------------------------------------------------------- state */

  const point = data.points[Math.min(cursor, data.points.length - 1)] ?? null;
  const done = cursor >= bars - 1;

  const flashes = useMemo<Flash[]>(() => {
    const now = data.candles[Math.min(cursor, bars - 1)]?.t ?? 0;
    const out: Flash[] = [];
    for (let i = Math.max(0, cursor - 30); i <= cursor; i += 1) {
      for (const f of fillsAtBar.get(i) ?? []) {
        const age = now - f.time;
        if (age < 0 || age > FLASH_MS * 60) continue;
        out.push({
          key: String(f.tid),
          isBuy: f.side === "B",
          usd: f.sz * f.px,
          px: f.px,
          liquidation: f.liquidation,
          dir: f.dir,
          at: f.time,
        });
      }
    }
    return out.slice(-3);
  }, [cursor, bars, fillsAtBar, data.candles]);

  const held = duration(data.candles[bars - 1]!.t - data.candles[0]!.t);

  return (
    <div className="flex flex-col gap-3">
      {/* ------------------------------------------------------------ head */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tracking-tight">{data.label}</span>
            <SideBadge side={data.side} />
            {data.liquidated && (
              <span className="rounded-sm bg-amber px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-ground">
                LIQUIDATED
              </span>
            )}
            {data.open && (
              <span className="rounded-sm border border-tx-3 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-tx-3">
                STILL OPEN
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-tx-3">
            {shortAddress(data.wallet, 8)} · {held} · {data.interval} bars
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-4xl font-bold tracking-tight tabular-nums"
            style={{ color: (point?.total ?? 0) >= 0 ? MINT : SIGNAL }}
          >
            {signedUsd(point?.total ?? 0)}
          </div>
          <div className="text-xs text-tx-3">
            {point && point.qty !== 0
              ? `holding ${size(Math.abs(point.qty))} @ ${price(data.avgEntry)}`
              : "flat"}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- chart */}
      <div className="relative">
        <div ref={priceRef} className="h-[340px] w-full sm:h-[420px]" />

        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
          {flashes.map((f) => (
            <div
              key={f.key}
              className="rounded-sm px-2 py-1 text-xs font-bold backdrop-blur-sm"
              style={{
                background: f.liquidation ? `${AMBER}22` : f.isBuy ? `${MINT}22` : `${SIGNAL}22`,
                color: f.liquidation ? AMBER : f.isBuy ? MINT : SIGNAL,
              }}
            >
              {f.liquidation ? "LIQUIDATED " : ""}
              {f.dir} · {signedUsd(f.usd).replace("+", "")} @ {price(f.px)}
            </div>
          ))}
        </div>

        {done && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded border border-line bg-ground/85 px-6 py-4 text-center backdrop-blur-sm">
              <div
                className="text-3xl font-bold"
                style={{ color: data.net >= 0 ? MINT : SIGNAL }}
              >
                {signedUsd(data.net)}
              </div>
              <div className="mt-1 text-xs text-tx-3">
                {pct(data.roe)} on {data.interval} bars · fees {signedUsd(-data.fees)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- pnl */}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-widest text-tx-3">
          running pnl
        </div>
        <div ref={pnlRef} className="h-[86px] w-full" />
      </div>

      {/* --------------------------------------------------------- transport */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button
          onClick={() => (done ? restart() : setPlaying((p) => !p))}
          className="rounded-sm bg-tx px-4 py-1.5 text-sm font-bold text-ground hover:opacity-90"
        >
          {done ? "run it back" : playing ? "pause" : "play"}
        </button>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded-sm px-2 py-1 text-xs ${
                speed === s ? "bg-raised text-tx" : "text-tx-3 hover:text-tx-2"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(0, bars - 1)}
          value={cursor}
          onChange={(e) => {
            setPlaying(false);
            setCursor(Number(e.target.value));
          }}
          className="min-w-[160px] flex-1 accent-amber"
          aria-label="scrub"
        />

        <span className="text-xs text-tx-3 tabular-nums">
          {clock(data.candles[Math.min(cursor, bars - 1)]!.t)}
        </span>
      </div>

      {/* ------------------------------------------------------------ stats */}
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="realized" value={signedUsd(data.realized)} tone={data.realized} />
        <Stat label="fees" value={`−$${data.fees.toFixed(2)}`} />
        <Stat label="net" value={signedUsd(data.net)} tone={data.net} />
        <Stat label="return" value={pct(data.roe)} tone={data.roe} />
        <Stat label="best" value={signedUsd(data.peak)} tone={data.peak} />
        <Stat label="worst" value={signedUsd(data.trough)} tone={data.trough} />
      </div>

      <Export data={data} />

      {data.truncatedStart && (
        <p className="text-xs text-amber">
          This position was already open when the window began, so the entries are not on
          the chart. The exit is exact; the running total before it is not.
        </p>
      )}

      {/* ------------------------------------------------------------ fills */}
      <details className="text-xs">
        <summary className="cursor-pointer py-2 text-tx-3 hover:text-tx-2">
          {data.fills.length} fills
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse">
            <tbody>
              {data.fills.map((f) => (
                <tr key={f.tid} className="border-b border-line/60">
                  <td className="py-1.5 pr-3 text-tx-3">{clock(f.time)}</td>
                  <td
                    className="py-1.5 pr-3 font-bold"
                    style={{ color: f.liquidation ? AMBER : f.side === "B" ? MINT : SIGNAL }}
                  >
                    {f.liquidation ? "LIQ " : ""}
                    {f.dir}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-tx-2">{size(f.sz)}</td>
                  <td className="py-1.5 pr-3 text-right text-tx-2">@ {price(f.px)}</td>
                  <td
                    className="py-1.5 text-right"
                    style={{ color: f.closedPnl === 0 ? TX3 : f.closedPnl > 0 ? MINT : SIGNAL }}
                  >
                    {f.closedPnl === 0 ? "—" : signedUsd(f.closedPnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/**
 * The export panel.
 *
 * Deliberately not a single "download" button. The shape has to be chosen before anything
 * renders, because the clip is built at the target size rather than recorded and cropped,
 * and a 9:16 clip is not a 16:9 one with the sides taken off: the type scales differently
 * and the fill labels move to the other edge of the chart.
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
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          {(Object.keys(FORMATS) as Shape[]).map((s) => (
            <button
              key={s}
              onClick={() => setShape(s)}
              disabled={busy}
              className={`rounded-sm px-2 py-1 text-xs disabled:opacity-40 ${
                shape === s ? "bg-raised text-tx" : "text-tx-3 hover:text-tx-2"
              }`}
            >
              {FORMATS[s].label}
            </button>
          ))}
        </div>

        <button
          onClick={busy ? () => (cancelled.current = true) : run}
          className="rounded-sm border border-line-2 px-4 py-1.5 text-sm font-bold hover:border-tx-2"
        >
          {busy ? `cancel · ${Math.round(progress * 100)}%` : "export mp4"}
        </button>

        <span className="text-xs text-tx-3">
          rendered at {FORMATS[shape].w}×{FORMATS[shape].h}, in your browser
        </span>
      </div>

      {busy && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-amber transition-[width] duration-150"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      {error && <p className="text-xs text-signal">{error}</p>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const color = tone === undefined ? TX : tone >= 0 ? MINT : SIGNAL;
  return (
    <div className="bg-ground px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-tx-3">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function SideBadge({ side }: { side: "LONG" | "SHORT" | "FLIP" }) {
  const color = side === "LONG" ? MINT : side === "SHORT" ? SIGNAL : AMBER;
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-widest"
      style={{ background: `${color}22`, color }}
    >
      {side}
    </span>
  );
}
