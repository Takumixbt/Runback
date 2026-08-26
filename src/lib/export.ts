/**
 * Turning a replay into a file people can post.
 *
 * The chart on screen is whatever width the viewport happens to be, at whatever pixel
 * ratio the display has, which is an aspect ratio no platform wants. So the export does
 * not record the visible chart at all: it builds a second one off-screen at the export
 * size, steps it a bar at a time, screenshots each state, and hands the bitmap to
 * `frame.paint` to have the header and figures drawn back on around it.
 *
 * Encoding is `clip.encode`, which is WebCodecs with explicit per-frame timestamps, so a
 * machine that cannot composite 1080p in 33ms produces the same file rather than a slower
 * one.
 */

import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  encode,
  FPS,
  FORMATS,
  layoutFor,
  MAX_CLIP_SECONDS,
  negotiate,
  OUTRO_SECONDS,
  type Encoders,
  type Shape,
} from "@/lib/clip";
import { paint, type PaintFill } from "@/lib/frame";
import type { Replay } from "@/lib/episodes";

const GROUND = "#0f1a1e";
const LINE = "#273035";
const TX3 = "#9aa3a4";
const MINT = "#50d2c1";
const SIGNAL = "#ed7088";
const AMBER = "#97fce4";

/** Mirrors the screen, so a clip frames the trade the same way the replay did. */
const WINDOW_BARS = 95;
const RIGHT_PAD = 6;

/** How long a fill label stays up, and how long it takes to arrive and leave. */
const FLASH_HOLD = 1400;
const FLASH_IN = 220;
const FLASH_OUT = 380;

export interface ExportOptions {
  shape: Shape;
  onProgress?: (fraction: number) => void;
  cancelled?: () => boolean;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
}

/**
 * How long the clip runs, and therefore how fast the bars go past.
 *
 * Not a fixed bar rate. A 45-bar trade at a fixed rate is a two-second video and a
 * 1,200-bar one is forty seconds, so the pacing is derived the other way round: pick a
 * duration inside the ceiling and divide. Short replays get a floor so they are watchable.
 */
function pacing(bars: number): { seconds: number; frames: number } {
  /**
   * Roughly an eighth of a second a bar, floored so a short trade is still watchable and
   * ceilinged by what the muxer can hold in memory. The old rate was 35ms a bar, which
   * put a hundred-bar position on screen for three and a half seconds.
   */
  const ideal = Math.min(MAX_CLIP_SECONDS - OUTRO_SECONDS, Math.max(9, bars * 0.13));
  return { seconds: ideal, frames: Math.round((ideal + OUTRO_SECONDS) * FPS) };
}

export async function exportClip(
  data: Replay,
  opts: ExportOptions,
): Promise<ExportResult | null> {
  const encoders: Encoders | null = await negotiate();
  if (!encoders) throw new Error("This browser cannot encode video. Try Chrome or Edge.");

  /**
   * Canvas cannot wait for a webfont the way the DOM can.
   *
   * `ctx.fillText` with a face the document has not finished loading silently falls back,
   * so an export started early comes out in the system UI font while the page around it is
   * in Inter. Waiting costs nothing on a warm load and fixes the cold one.
   */
  try {
    await document.fonts.ready;
  } catch {
    // No Font Loading API. The fallback stack is still correct, just not Inter.
  }

  const layout = layoutFor(opts.shape);
  const bars = data.candles.length;
  if (bars === 0) return null;

  const { seconds, frames } = pacing(bars);
  const replayFrames = Math.round(seconds * FPS);

  /* ------------------------------------------------- the offscreen chart */

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${layout.chart.w}px;height:${layout.chart.h}px;`;
  document.body.appendChild(host);

  const chart = createChart(host, {
    width: layout.chart.w,
    height: layout.chart.h,
    layout: {
      background: { color: GROUND },
      textColor: TX3,
      fontFamily: "inherit",
      attributionLogo: false,
      /**
       * Type scaled to the frame, not to the 992-wide design.
       *
       * Without this the axis labels stay at their CSS size while everything around them
       * doubles, and the chart reads as a low-resolution insert in a high-resolution frame.
       */
      fontSize: Math.round(12 * (layout.chart.w / 992) * 1.6),
    },
    grid: { vertLines: { color: "#ffffff07" }, horzLines: { color: "#ffffff07" } },
    rightPriceScale: { borderColor: LINE, scaleMargins: layout.scaleMargins },
    timeScale: { borderColor: LINE, timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
    handleScroll: false,
    handleScale: false,
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

  const candleData: CandlestickData<Time>[] = data.candles.map((c) => ({
    time: (c.t / 1000) as UTCTimestamp,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
  }));

  const markerApi = createSeriesMarkers(series, []);

  const barOf = (ts: number): number => {
    let lo = 0;
    let hi = data.candles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (data.candles[mid]!.t <= ts) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  /**
   * One marker per bar, matching the on-screen replay.
   *
   * A TWAP'd position carries hundreds of fills landing on a handful of bars. Drawn one
   * per fill they stack into an unreadable smear, and every exported frame pays to filter
   * the whole list. Merged by bar the picture is legible and the per-frame cost stops
   * scaling with fill count.
   */
  const me = data.wallet.toLowerCase();
  const wasLiquidated = (f: { liquidatedUser: string | null }) => f.liquidatedUser === me;

  const cells = new Map<number, { buy: number; sell: number; liq: boolean; n: number }>();
  for (const f of data.fills) {
    const b = barOf(f.time);
    const cell = cells.get(b) ?? { buy: 0, sell: 0, liq: false, n: 0 };
    if (f.side === "B") cell.buy += f.sz * f.px;
    else cell.sell += f.sz * f.px;
    if (wasLiquidated(f)) cell.liq = true;
    cell.n += 1;
    cells.set(b, cell);
  }
  const markerBars = [...cells.keys()].sort((a, b) => a - b);
  const allMarkers: SeriesMarker<Time>[] = markerBars.map((b) => {
    const cell = cells.get(b)!;
    const isBuy = cell.buy >= cell.sell;
    return {
      time: (data.candles[b]!.t / 1000) as UTCTimestamp,
      position: isBuy ? "belowBar" : "aboveBar",
      color: cell.liq ? AMBER : isBuy ? MINT : SIGNAL,
      shape: isBuy ? "arrowUp" : "arrowDown",
      text: cell.liq ? "LIQ" : "",
    } satisfies SeriesMarker<Time>;
  });

  /** Markers at or before each bar, so a frame slices instead of scanning. */
  const markersUpto = new Int32Array(data.candles.length);
  for (let i = 0, k = 0; i < data.candles.length; i += 1) {
    while (k < markerBars.length && markerBars[k]! <= i) k += 1;
    markersUpto[i] = k;
  }

  /**
   * A window, exactly as the screen uses. This is what made every export look zoomed.
   *
   * Pinning the whole time span from frame zero while the series holds only the bars
   * revealed so far means the drawn bars are crammed into a sliver at the left, and the
   * price scale, which fits what it HOLDS rather than what is shown, stretches those few
   * bars over the full height. The result reads as a chart zoomed hard into its own corner,
   * for the entire clip.
   *
   * Same fix as the screen: open on a window of WINDOW_BARS and let the chart scroll itself
   * as bars are appended.
   */
  series.setData(candleData.slice(0, 1));
  chart.timeScale().setVisibleLogicalRange(
    bars <= WINDOW_BARS
      ? { from: -RIGHT_PAD / 2, to: bars - 1 + RIGHT_PAD / 2 }
      : { from: -RIGHT_PAD, to: WINDOW_BARS - RIGHT_PAD },
  );

  let painted = -1;

  const stepTo = (index: number, frac: number): void => {
    if (index < painted) {
      series.setData(candleData.slice(0, index + 1));
      if (bars > WINDOW_BARS) {
        chart.timeScale().setVisibleLogicalRange({
          from: index - WINDOW_BARS + RIGHT_PAD,
          to: index + RIGHT_PAD,
        });
      }
    } else {
      for (let k = painted + 1; k < index; k += 1) series.update(candleData[k]!);
    }

    /** The bar being lived through, eased, matching the screen exactly. */
    const bar = candleData[index]!;
    const p = frac * frac * (3 - 2 * frac);
    const close = bar.open + (bar.close - bar.open) * p;
    series.update({
      time: bar.time,
      open: bar.open,
      close,
      high: Math.max(bar.open, close, bar.open + (bar.high - bar.open) * p),
      low: Math.min(bar.open, close, bar.open + (bar.low - bar.open) * p),
    });

    if (index !== painted) {
      markerApi.setMarkers(allMarkers.slice(0, markersUpto[index] ?? 0));
    }
    painted = index;
  };

  /* -------------------------------------------------------- frame source */

  const spanMs = data.candles[bars - 1]!.t - data.candles[0]!.t;
  const startMs = data.candles[0]!.t;

  /** Chart-time at a given frame, so fill labels can be timed against real timestamps. */
  const timeAt = (frame: number): number =>
    startMs + (Math.min(frame, replayFrames) / replayFrames) * spanMs;

  const fillsFor = (nowMs: number): PaintFill[] => {
    const out: PaintFill[] = [];
    /** A whole clip's worth of bars can pass in one frame, so scale the label life too. */
    const scale = Math.max(1, spanMs / (replayFrames * (1000 / FPS)));
    const hold = FLASH_HOLD * scale;
    const arrive = FLASH_IN * scale;
    const leave = FLASH_OUT * scale;

    for (const f of data.fills) {
      const age = nowMs - f.time;
      if (age < 0 || age > hold) continue;
      if (out.length >= 3) break;
      const alpha =
        age < arrive
          ? age / arrive
          : age > hold - leave
            ? Math.max(0, (hold - age) / leave)
            : 1;
      out.push({
        isBuy: f.side === "B",
        liquidation: wasLiquidated(f),
        dir: f.dir,
        usd: f.sz * f.px,
        px: f.px,
        slot: out.length,
        alpha,
        // The wash is on its own shorter curve and gone the moment the label leaves.
        wash: age > hold - leave ? 0 : Math.max(0, 1 - age / (hold * 0.6)),
      });
    }
    return out.slice(-3);
  };

  try {
    const result = await encode({
      shape: opts.shape,
      encoders,
      frames,
      fps: FPS,
      audio: null,
      cancelled: () => opts.cancelled?.() ?? false,
      onProgress: (i) => opts.onProgress?.(i / frames),
      draw: (ctx, i) => {
        const exact = i >= replayFrames ? bars - 1 : (i / replayFrames) * bars;
        const barIndex = Math.min(Math.floor(exact), bars - 1);
        stepTo(barIndex, i >= replayFrames ? 1 : exact - barIndex);

        const point = data.points[Math.min(barIndex, data.points.length - 1)] ?? null;
        const nowMs = timeAt(i);

        paint(ctx, {
          layout,
          shot: chart.takeScreenshot(),
          label: data.label,
          wallet: data.wallet,
          side: data.side,
          total: i >= replayFrames ? data.net : (point?.total ?? 0),
          qty: point?.qty ?? 0,
          avgEntry: data.avgEntry,
          fills: i >= replayFrames ? [] : fillsFor(nowMs),
          liquidated: data.liquidated,
          outro:
            i <= replayFrames
              ? 0
              : Math.min(1, (i - replayFrames) / (OUTRO_SECONDS * FPS * 0.45)),
          final: {
            net: data.net,
            realized: data.realized,
            fees: data.fees,
            roe: data.roe ?? 0,
            peak: data.peak,
            trough: data.trough,
          },
        });
      },
    });

    if (!result) return null;

    const stamp = new Date(data.candles[0]!.t).toISOString().slice(0, 10);
    const safe = data.label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    return {
      blob: result.blob,
      filename: `runback-${safe}-${stamp}.${result.ext}`,
    };
  } finally {
    chart.remove();
    host.remove();
  }
}

export { FORMATS, type Shape };
