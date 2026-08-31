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
import { duration, usdCompact } from "@/lib/format";
import type { Replay } from "@/lib/episodes";
import { renderTrack, type TimedCue } from "@/lib/sound";
import { sameIdentity } from "@/lib/venue";

const GROUND = "#0f1a1e";
const LINE = "#273035";
const TX3 = "#9aa3a4";
const MINT = "#50d2c1";
const SIGNAL = "#ed7088";
const AMBER = "#97fce4";

/** Mirrors the screen, so a clip frames the trade the same way the replay did. */
const BAR_SPACING = 9;

/** How long one bar is held at 1x — the number the on-screen replay holds a bar for. */
const STEP_MS = 600;

/** Once per this much gained, the fanfare sounds. The live replay's high-water mark. */
const FANFARE_AT = 20_000;

/**
 * A fill label's envelopes, matching the screen: 240ms in and out, a 1,400ms hold, and
 * the wash on its own 900ms curve.
 */
const FLASH_MS = 1_400;
const FADE_MS = 240;

export interface ExportOptions {
  shape: Shape;
  /** The replay's current speed, so the clip runs at the pace being watched. */
  speed?: number;
  onProgress?: (fraction: number) => void;
  cancelled?: () => boolean;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
}

/**
 * How long the clip runs: exactly as long as the replay takes at the current speed.
 *
 * Every bar is held the same time — 600ms at 1x, forming as it goes — then the outro.
 * Deriving a bar rate from a target duration did the opposite of this: a
 * four-hundred-bar trade was smeared into a blur and a forty-bar one raced past. A clip
 * that would run past the memory ceiling is REFUSED rather than compressed, and the
 * panel says to raise the speed — Trickshot's answer to the same wall.
 */
function pacing(bars: number, speed: number): { stepMs: number; seconds: number; frames: number } {
  const stepMs = STEP_MS / speed;
  const seconds = (bars * stepMs) / 1000;
  return { stepMs, seconds, frames: Math.round((seconds + OUTRO_SECONDS) * FPS) };
}

/** The wash a fill throws, on the 900ms curve the screen's `replay-wash` keyframe describes. */
function washAt(age: number): number {
  if (age < 0 || age > 900) return 0;
  return age < 198 ? age / 198 : 1 - (age - 198) / 702;
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

  const { stepMs, seconds, frames } = pacing(bars, opts.speed ?? 1);
  if (seconds + OUTRO_SECONDS > MAX_CLIP_SECONDS) {
    throw new Error(
      `That clip would run ~${Math.round(seconds + OUTRO_SECONDS)}s, past the ` +
        `${MAX_CLIP_SECONDS}s ceiling — raise the replay speed and it will fit.`,
    );
  }
  const replayFrames = Math.round(seconds * FPS);

  /** Which bar a moment falls in. */
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

  const me = data.wallet;
  const wasLiquidated = (f: { liquidatedUser: string | null }) =>
    !!f.liquidatedUser && sameIdentity(f.liquidatedUser, me);

  /**
   * One cell per bar that traded: money in, money out, whether it was forced.
   *
   * The soundtrack, the fill labels and the running fill count all read from this, so
   * none of them can disagree about what happened in a bar — re-deriving it per
   * consumer is exactly how an earlier exporter drifted away from the screen.
   */
  const cells = new Map<
    number,
    { buy: number; sell: number; buySz: number; sellSz: number; liq: boolean }
  >();
  const fillsPerBar = new Int32Array(bars);
  for (const f of data.fills) {
    const b = barOf(f.time);
    const cell = cells.get(b) ?? { buy: 0, sell: 0, buySz: 0, sellSz: 0, liq: false };
    if (f.side === "B") {
      cell.buy += f.sz * f.px;
      cell.buySz += f.sz;
    } else {
      cell.sell += f.sz * f.px;
      cell.sellSz += f.sz;
    }
    if (wasLiquidated(f)) cell.liq = true;
    cells.set(b, cell);
    fillsPerBar[b] = (fillsPerBar[b] ?? 0) + 1;
  }
  /** Fills landed at or before each bar, so a frame reads a cell instead of scanning. */
  const fillsUpto = new Int32Array(bars);
  {
    let run = 0;
    for (let i = 0; i < bars; i += 1) {
      run += fillsPerBar[i] ?? 0;
      fillsUpto[i] = run;
    }
  }

  /**
   * The soundtrack, rendered before a single frame is drawn.
   *
   * The same cues the live replay sounds, on the same rule: one till per BAR that sold
   * something rather than one per fill, the fanfare on each $20K high-water mark, a
   * liquidation's weight, and the full stop on the end card. A cue sits at
   * bar × stepMs, which is exactly where the frame walk puts that bar, so a sound lands
   * on the frame its marker appears.
   */
  const track = await (async () => {
    const cues: TimedCue[] = [];
    let tier = Math.max(Math.floor((data.points[0]?.total ?? 0) / FANFARE_AT), 0);
    for (let bar = 0; bar < bars; bar += 1) {
      const at = (bar * stepMs) / 1000;
      const cell = cells.get(bar);
      if (cell) {
        if (cell.sell > 0) cues.push({ cue: "sell", at });
        if (cell.liq) cues.push({ cue: "liquidation", at });
      }
      // The opening bar ARMS the fanfare rather than sounding it: a window that opens
      // mid-position can already be up six figures, and four stacked blasts is noise.
      if (bar === 0) continue;
      const reached = Math.floor((data.points[bar]?.total ?? 0) / FANFARE_AT);
      if (reached > tier) {
        tier = reached;
        cues.push({ cue: "profit", at });
      }
    }
    // The full stop, on the end card rather than on the last bar.
    cues.push({ cue: "settle", at: seconds + 0.15 });
    return renderTrack(cues, seconds + OUTRO_SECONDS);
  })();

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
    timeScale: {
      borderColor: LINE,
      timeVisible: true,
      secondsVisible: false,
      /**
       * Bar width scaled to the frame, and half a screen of room ahead of the newest bar.
       *
       * The export renders at up to 1920 wide against a 992-wide design, so the screen's
       * nine pixels a bar would draw hairlines in a 1080p clip. Everything else matches the
       * replay exactly: fixed spacing, room ahead, and the chart scrolling itself.
       */
      barSpacing: Math.round(BAR_SPACING * (layout.chart.w / 992)),
      rightOffset: Math.round(
        layout.chart.w / Math.round(BAR_SPACING * (layout.chart.w / 992)) / 2,
      ),
      shiftVisibleRangeOnNewBar: true,
      lockVisibleTimeRangeOnResize: true,
    },
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
    /** The live mark, tagged on the scale, exactly as the on-screen chart carries it. */
    priceLineVisible: true,
    priceLineColor: TX3,
    priceLineWidth: 1,
    priceLineStyle: 2,
    lastValueVisible: true,
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

  /** The same markers the screen carries, so a clip is the replay rather than a cousin. */
  const { markers: allMarkers, upto: markersUpto } = buildMarkers(data);

  series.setData([]);

  let painted = -1;

  /** Identical to the screen's `paintTo`, so a clip is the replay rather than a cousin. */
  const stepTo = (index: number, frac: number): void => {
    if (painted !== index) {
      if (index > 0 && painted === index - 1) {
        // The bar that was forming is history now; snap it to its real close.
        series.update(candleData[index - 1]!);
      } else {
        series.setData(candleData.slice(0, index));
        chart.timeScale().scrollToRealTime();
      }
      markerApi.setMarkers(allMarkers.slice(0, markersUpto[index] ?? 0));
      painted = index;
    }

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
  };

  /* -------------------------------------------------------- frame source */

  /**
   * Bars that carried fills, merged per side the way a single label represents them,
   * with the clip time each lands at.
   *
   * The unit is the LABEL, not the fill: a TWAP puts twenty slices in one bar, and
   * twenty numbers climbing the frame together say less than two do. Both the live
   * overlay and this walk read fills summed per bar per side, so neither can disagree
   * with the other about what happened in a bar.
   */
  interface Merged {
    isBuy: boolean;
    liq: boolean;
    usd: number;
    /** Volume-weighted price of the fills the label sums. */
    px: number;
  }
  const filled: { bar: number; at: number; fills: Merged[] }[] = [];
  for (const [bar, cell] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
    const fills: Merged[] = [];
    if (cell.liq) {
      const usd = cell.buy + cell.sell;
      const sz = cell.buySz + cell.sellSz;
      fills.push({ isBuy: cell.buy >= cell.sell, liq: true, usd, px: sz > 0 ? usd / sz : 0 });
    } else {
      if (cell.buy > 0)
        fills.push({
          isBuy: true,
          liq: false,
          usd: cell.buy,
          px: cell.buySz > 0 ? cell.buy / cell.buySz : 0,
        });
      if (cell.sell > 0)
        fills.push({
          isBuy: false,
          liq: false,
          usd: cell.sell,
          px: cell.sellSz > 0 ? cell.sell / cell.sellSz : 0,
        });
    }
    filled.push({ bar, at: bar * stepMs, fills });
  }

  /**
   * The labels over the chart at one moment of the clip.
   *
   * Time here is clip time, not the wall clock, which is the whole reason the exporter
   * cannot reuse the live overlay's state. The displacement rule is the part that
   * matters: a new fill pushes the previous one OUT rather than stacking on it, so only
   * the most recent filled bar is ever fully on screen. Deriving this as "any fill
   * within FLASH_MS" instead would pile eighteen bars of labels on top of each other at
   * 8x, where the screen shows one.
   */
  const flashesAt = (cursor: number, clipMs: number): PaintFill[] => {
    const out: PaintFill[] = [];
    const live = filled[cursor];
    if (!live) return out;

    const push = (group: (typeof filled)[number], leftAt: number | null) => {
      group.fills.forEach((f, slot) => {
        const age = clipMs - group.at;
        const alpha =
          leftAt === null
            ? Math.min(1, age / FADE_MS)
            : Math.max(0, 1 - (clipMs - leftAt) / FADE_MS);
        if (alpha <= 0) return;
        out.push({
          isBuy: f.isBuy,
          liquidation: f.liq,
          usd: f.usd,
          px: f.px,
          slot,
          alpha,
          // The wash is on its own 900ms curve and gone the moment the label leaves.
          wash: leftAt === null ? washAt(age) : 0,
          out: leftAt !== null,
        });
      });
    };

    // Its time ran out with no later fill to displace it.
    const expired = clipMs - live.at > FLASH_MS;
    push(live, expired ? live.at + FLASH_MS : null);

    const before = filled[cursor - 1];
    if (before) push(before, live.at);

    return out;
  };

  /** The newest filled bar the clip has reached, walked forwards as frames advance. */
  let flashCursor = -1;

  try {
    const result = await encode({
      shape: opts.shape,
      encoders,
      frames,
      fps: FPS,
      audio: track,
      cancelled: () => opts.cancelled?.() ?? false,
      onProgress: (i) => opts.onProgress?.(i / frames),
      draw: (ctx, i) => {
        /**
         * Clip time to bar, at the same constant rate the live replay holds a bar.
         * The last bar forms like every other: the outro does not start until its own
         * step has run, so the trade finishes at the pace it was watched at.
         */
        const clipMs = Math.min(i / FPS, seconds) * 1000;
        const exact = clipMs / stepMs;
        const barIndex = Math.min(Math.floor(exact), bars - 1);
        stepTo(barIndex, i >= replayFrames ? 1 : Math.min(exact - barIndex, 1));

        while (flashCursor + 1 < filled.length && filled[flashCursor + 1]!.at <= clipMs) {
          flashCursor += 1;
        }

        const point = data.points[Math.min(barIndex, data.points.length - 1)] ?? null;

        paint(ctx, {
          layout,
          shot: chart.takeScreenshot(),
          label: data.label,
          wallet: data.wallet,
          venue: data.venueName,
          side: data.side,
          total: i >= replayFrames ? data.net : (point?.total ?? 0),
          qty: point?.qty ?? 0,
          avgEntry: data.avgEntry,
          point,
          trades: fillsUpto[barIndex] ?? 0,
          fills: i >= replayFrames ? [] : flashesAt(flashCursor, clipMs),
          liquidated: data.closedByLiquidation,
          outro:
            i < replayFrames
              ? 0
              : Math.min(1, (i - replayFrames + 1) / (OUTRO_SECONDS * FPS)),
          final: {
            net: data.net,
            realized: data.realized,
            fees: data.fees,
            roe: data.roe ?? 0,
            peak: data.peak,
            trough: data.trough,
            held: duration(
              data.candles[bars - 1]!.t - data.candles[0]!.t,
            ),
          },
        });
      },
    });

    if (!result) return null;

    const stamp = new Date(data.candles[0]!.t).toISOString().slice(0, 10);
    const safe = data.label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    return {
      blob: result.blob,
      filename: `runback-${data.venue}-${safe}-${stamp}.${result.ext}`,
    };
  } finally {
    chart.remove();
    host.remove();
  }
}

/**
 * The most marker-carrying bars a chart will keep, liquidations excepted.
 *
 * Enough to show where a position was built and taken off, few enough that each one is
 * still a separate thing you can look at. A HIP-3 market maker's position can carry 911
 * fills; merged per bar that is still a marker on nearly every bar, which is a ribbon,
 * not an annotation.
 */
const MAX_MARKERS = 40;

/**
 * The wallet's fills as chart markers — one circle per bar per side, the text going to
 * the biggest fills, liquidations always kept and always speaking.
 *
 * Shared by the live replay and the exporter, so a clip cannot disagree with the screen
 * about where the trades were. Circles rather than arrows, Trickshot's marker: quieter
 * at a glance, and the side is already in which edge of the bar the marker hangs off.
 */
export function buildMarkers(data: Replay): {
  markers: SeriesMarker<Time>[];
  /** How many markers exist at or before each bar, so a frame is a slice not a scan. */
  upto: Int32Array;
} {
  const bars = data.candles.length;
  const me = data.wallet;

  const barOf = (ts: number): number => {
    let lo = 0;
    let hi = bars - 1;
    if (hi < 0) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (data.candles[mid]!.t <= ts) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const byBar = new Map<number, { buy: number; sell: number; liq: boolean }>();
  for (const f of data.fills) {
    const b = Math.max(0, barOf(f.time));
    const cell = byBar.get(b) ?? { buy: 0, sell: 0, liq: false };
    if (f.side === "B") cell.buy += f.sz * f.px;
    else cell.sell += f.sz * f.px;
    if (f.liquidatedUser && sameIdentity(f.liquidatedUser, me)) cell.liq = true;
    byBar.set(b, cell);
  }

  /**
   * Only the bars that moved the most money get a marker.
   *
   * Ranking bars by the money that moved and keeping the largest leaves the entries,
   * the exits and the big adds, which is the shape of the trade. Everything dropped is
   * a top-up too small to change the story, and it is still in the fill table
   * underneath. Liquidations are never dropped, whatever they cost.
   */
  const scored = [...byBar.entries()].map(([bar, cell]) => ({
    bar,
    cell,
    moved: cell.buy + cell.sell,
  }));
  const keep = new Set<number>();
  for (const s of scored) if (s.cell.liq) keep.add(s.bar);
  scored
    .filter((s) => !s.cell.liq)
    .sort((a, b) => b.moved - a.moved)
    .slice(0, Math.max(0, MAX_MARKERS - keep.size))
    .forEach((s) => keep.add(s.bar));

  const kept = scored.filter((s) => keep.has(s.bar)).sort((a, b) => a.bar - b.bar);

  /**
   * One marker per bar PER SIDE: a buy hangs below the bar and a sell above, so a bar
   * that did both carries both and they can never overlap. A liquidation is one marker
   * on the dominant side.
   */
  interface Pending {
    bar: number;
    isBuy: boolean;
    liq: boolean;
    usd: number;
  }
  const pending: Pending[] = [];
  for (const { bar, cell } of kept) {
    if (cell.liq) {
      pending.push({ bar, isBuy: cell.buy >= cell.sell, liq: true, usd: cell.buy + cell.sell });
    } else {
      if (cell.buy > 0) pending.push({ bar, isBuy: true, liq: false, usd: cell.buy });
      if (cell.sell > 0) pending.push({ bar, isBuy: false, liq: false, usd: cell.sell });
    }
  }

  /** Rough width of a marker label at the chart's 11px. Trickshot's estimate. */
  const widthOf = (text: string) => text.length * 6.2 + 10;
  const full = (m: Pending) => `${m.isBuy ? "BUY" : "SELL"} ${usdCompact(m.usd)}`;
  const compact = (m: Pending) => usdCompact(m.usd);

  /**
   * Which markers on one side of the bars can carry text without overlapping.
   *
   * Bars are nine pixels apart and "SELL $12.3K" is about seventy, so any two labels
   * within a few bars of each other collide. Every marker keeps its circle; the TEXT
   * goes to the biggest fills first, and a smaller one inside the room an
   * already-placed label needs stays a circle. Full labels where they all fit, short
   * ones where they do not.
   */
  const placeText = (side: Pending[], write: (m: Pending) => string) => {
    const out = new Map<Pending, string>();
    const placed: { bar: number; half: number }[] = [];
    for (const m of [...side].sort((a, b) => b.usd - a.usd)) {
      const text = write(m);
      const half = widthOf(text) / 2;
      const clear = placed.every(
        (o) => Math.abs(o.bar - m.bar) * BAR_SPACING >= o.half + half,
      );
      if (!clear) continue;
      placed.push({ bar: m.bar, half });
      out.set(m, text);
    }
    return out;
  };

  const text = new Map<Pending, string>();
  for (const isBuy of [true, false]) {
    const side = pending.filter((m) => m.isBuy === isBuy && !m.liq);
    const long = placeText(side, full);
    const short = long.size === side.length ? long : placeText(side, compact);
    for (const [m, t] of short.size > long.size ? short : long) text.set(m, t);
  }

  // Ascending by bar, which is ascending by time — the library insists on it.
  const ordered = pending.sort((a, b) => a.bar - b.bar || Number(b.isBuy) - Number(a.isBuy));
  const markers: SeriesMarker<Time>[] = ordered.map((m) => ({
    time: (data.candles[m.bar]!.t / 1000) as UTCTimestamp,
    position: m.isBuy ? "belowBar" : "aboveBar",
    color: m.liq ? AMBER : m.isBuy ? MINT : SIGNAL,
    shape: "circle",
    text: m.liq ? `LIQ ${usdCompact(m.usd)}` : (text.get(m) ?? ""),
  }));

  const upto = new Int32Array(bars);
  let k = 0;
  for (let i = 0; i < bars; i += 1) {
    while (k < ordered.length && ordered[k]!.bar <= i) k += 1;
    upto[i] = k;
  }
  return { markers, upto };
}

export { FORMATS, type Shape };
