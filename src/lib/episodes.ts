/**
 * Turning a stream of fills into a list of plays.
 *
 * This is the whole reason Runback can be wallet-first when Trickshot could not.
 * Solana hands you holdings with no timestamps, so a wallet resolves to a list of
 * TOKENS and you guess which are interesting. Hyperliquid fills carry time, direction
 * and realised PnL, so a wallet resolves to a list of POSITIONS: flat, open, scale,
 * close, flat. Each one has a start, an end and a number, which is exactly the unit
 * a clip wants.
 */

import type { Candle, Fill } from "./hl";

export interface Episode {
  /** Stable across rebuilds: the coin and the opening fill's trade id. */
  id: string;
  coin: string;
  side: "LONG" | "SHORT" | "FLIP";
  start: number;
  end: number;
  /** Still open at the time of the query. There is no exit and no final number. */
  open: boolean;
  /**
   * The window began mid-position, so the opening trades are not in view.
   *
   * Detected from the first fill's `startPosition` rather than inferred. A replay of
   * one of these is honest about only showing the exit.
   */
  truncatedStart: boolean;
  fills: Fill[];
  /** Largest absolute position size the wallet held during the episode. */
  peakSize: number;
  /** That size valued at the price it was reached at. The number people care about. */
  peakNotional: number;
  /** Sum of `closedPnl`. Hyperliquid computed it. BEFORE fees. */
  realized: number;
  /** Only counted where `feeToken` is USDC; a spot fee paid in UBTC needs a price to convert. */
  fees: number;
  /** Realised minus the fees we could account for. */
  net: number;
  /** A forced close happened inside this episode. The money shot. */
  liquidated: boolean;
  /** The position went from long straight to short or back without passing through flat. */
  flipped: boolean;
  /** Volume-weighted average entry, for the side the episode opened on. */
  avgEntry: number;
}

/** Position sizes are summed floats, so "flat" is never exactly zero. */
const FLAT = 1e-9;

/**
 * Split one wallet's fills into episodes, best first.
 *
 * A flip (`dir` containing ">") crosses through zero in a single fill and is deliberately
 * NOT treated as two episodes. Splitting there reads tidier in a table and makes a worse
 * clip, and the clip is the product: "he was long, he flipped, it kept going" is one story.
 * The episode is marked `flipped` so the UI can say so.
 */
export function episodes(all: Fill[]): Episode[] {
  const byCoin = new Map<string, Fill[]>();
  for (const f of all) {
    const list = byCoin.get(f.coin);
    if (list) list.push(f);
    else byCoin.set(f.coin, [f]);
  }

  const out: Episode[] = [];

  for (const [coin, list] of byCoin) {
    list.sort((a, b) => a.time - b.time);

    /**
     * Seed from the first fill's own report of the position, not from zero.
     *
     * A window that opens mid-position starts with a closing fill, and starting the
     * running total at zero would drive it negative and label a long exit as a short.
     */
    let pos = list[0]?.startPosition ?? 0;
    /** Only the FIRST episode of a coin can be the one the window cut into. */
    let firstOfCoin = Math.abs(pos) > FLAT;

    let cur: Episode | null = null;
    let entryQty = 0;
    let entryCost = 0;

    for (const f of list) {
      const signed = f.side === "B" ? f.sz : -f.sz;
      const before = pos;
      pos += signed;

      if (!cur) {
        cur = {
          id: `${coin}-${f.tid}`,
          coin,
          side: (Math.abs(before) > FLAT ? before : pos) > 0 ? "LONG" : "SHORT",
          start: f.time,
          end: f.time,
          open: false,
          truncatedStart: firstOfCoin,
          fills: [],
          peakSize: 0,
          peakNotional: 0,
          realized: 0,
          fees: 0,
          net: 0,
          liquidated: false,
          flipped: false,
          avgEntry: 0,
        };
        entryQty = 0;
        entryCost = 0;
      }

      cur.fills.push(f);
      cur.end = f.time;
      cur.realized += f.closedPnl;
      if (f.feeToken === "USDC") cur.fees += f.fee;
      if (f.liquidation) cur.liquidated = true;
      if (f.dir.includes(">")) {
        cur.flipped = true;
        cur.side = "FLIP";
      }

      // Adding to the position, in whichever direction it currently runs.
      if (Math.abs(pos) > Math.abs(before)) {
        entryQty += f.sz;
        entryCost += f.sz * f.px;
      }

      const size = Math.abs(pos);
      if (size > cur.peakSize) {
        cur.peakSize = size;
        cur.peakNotional = size * f.px;
      }

      if (Math.abs(pos) < FLAT) {
        cur.avgEntry = entryQty > 0 ? entryCost / entryQty : f.px;
        cur.net = cur.realized - cur.fees;
        out.push(cur);
        cur = null;
        pos = 0;
        firstOfCoin = false;
      }
    }

    if (cur) {
      cur.open = true;
      cur.avgEntry = entryQty > 0 ? entryCost / entryQty : cur.fills[0]!.px;
      cur.net = cur.realized - cur.fees;
      out.push(cur);
    }
  }

  /**
   * Ranked by what was at stake, not by when it happened.
   *
   * Chronological is unusable past a few dozen fills: a market maker produces thousands
   * of episodes and none of the interesting ones are at the top. Open positions sort
   * first because they are the thing the owner is actually thinking about.
   */
  return out.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    return Math.abs(b.realized) - Math.abs(a.realized);
  });
}

/* ------------------------------------------------------------- intervals */

export const INTERVALS: { name: string; sec: number }[] = [
  { name: "1m", sec: 60 },
  { name: "5m", sec: 300 },
  { name: "15m", sec: 900 },
  { name: "1h", sec: 3600 },
  { name: "4h", sec: 14400 },
  { name: "1d", sec: 86400 },
];

/**
 * How far back each interval reaches.
 *
 * `candleSnapshot` serves at most 5,000 bars, and outside that it returns an empty array
 * rather than an error. MEASURED against the live endpoint: 1m at ten days back, 5m at
 * thirty, 15m at ninety, 1h at three hundred and 4h at nine hundred all return []; 1d at
 * twelve hundred days returns bars from May 2023. The rule holds exactly.
 */
export const MAX_CANDLES = 5000;

/** Below this a replay is a straight line with two dots on it, so it is not offered. */
export const MIN_BARS = 25;

/** Above this the chart is denser than the export can show and the fetch is wasteful. */
export const MAX_BARS = 1200;

/** Context either side of the trade, so the entry marker is not sitting on bar zero. */
export const PAD = 0.15;

export interface Window {
  interval: string;
  sec: number;
  from: number;
  to: number;
  bars: number;
}

/**
 * The finest interval that can actually draw this episode.
 *
 * Finest, not widest. The first version of this picked the widest interval that still
 * yielded 120 bars, which sounds reasonable and is wrong: every trade shorter than about
 * two hours failed the bar-count test at every interval and fell through to daily, so a
 * 34-minute scalp rendered as a single candle.
 *
 * Returns null when nothing works, which is a real and common outcome: a three-minute
 * trade from four days ago cannot be drawn, because 1m bars only reach back three and a
 * half days and 5m bars make the whole trade one candle.
 */
export function pickWindow(start: number, end: number, now = Date.now()): Window | null {
  const pad = (end - start) * PAD + 60_000;
  const from = Math.floor(start - pad);
  const to = Math.ceil(end + pad);
  const span = (to - from) / 1000;

  for (const { name, sec } of INTERVALS) {
    // The oldest timestamp this interval can still serve.
    const reach = now - MAX_CANDLES * sec * 1000;
    if (from < reach) continue;
    const bars = Math.ceil(span / sec);
    if (bars > MAX_BARS) continue;
    if (bars < MIN_BARS) continue;
    return { interval: name, sec, from, to, bars };
  }
  return null;
}

/** Why a window could not be found, in words a person can act on. */
export function whyNoWindow(start: number, end: number, now = Date.now()): string {
  const ageDays = (now - start) / 86_400_000;
  const mins = (end - start) / 60_000;
  const finest = INTERVALS.find(({ sec }) => start >= now - MAX_CANDLES * sec * 1000);
  if (!finest) return "older than any interval Hyperliquid still serves";
  const bars = Math.ceil((mins * 60) / finest.sec);
  if (bars < MIN_BARS) {
    return `${mins < 60 ? `${Math.round(mins)}m` : `${(mins / 60).toFixed(1)}h`} long and ${Math.round(
      ageDays,
    )} days old, so the finest bars still available (${finest.name}) give only ${bars}`;
  }
  return "too long to draw at any available interval";
}

/* ------------------------------------------------------------ the replay */

/** One step of the position, as the chart consumes it. */
export interface Point {
  t: number;
  /** Signed. Negative is short. */
  qty: number;
  price: number;
  realized: number;
  unrealized: number;
  total: number;
  /** Running fees, so the clip can show gross and net side by side. */
  fees: number;
}

export interface Replay {
  coin: string;
  label: string;
  wallet: string;
  side: Episode["side"];
  interval: string;
  candles: Candle[];
  fills: Fill[];
  points: Point[];
  avgEntry: number;
  realized: number;
  fees: number;
  net: number;
  /** Best and worst the running total ever got. The drawdown a PnL card hides. */
  peak: number;
  trough: number;
  /** Return on the peak notional held. Not account ROI, which needs deposits netted out. */
  roe: number;
  liquidated: boolean;
  open: boolean;
  truncatedStart: boolean;
}

/**
 * Fold fills onto bars.
 *
 * Two accountings run side by side for the same reason Trickshot kept two: the sum of
 * `closedPnl` is order-independent and comes from Hyperliquid, while the average-cost
 * fold is ours and is order-dependent. They should agree at the end of an episode. Where
 * they do not, something was double-counted, usually a TWAP slice or a flip.
 */
export function buildReplay(
  ep: Episode,
  candles: Candle[],
  label: string,
  wallet: string,
  interval: string,
): Replay {
  const points: Point[] = [];

  let qty = 0;
  let avg = 0;
  let realized = 0;
  let fees = 0;
  let i = 0;

  // Seed from the position the wallet already held when the window opened.
  if (ep.truncatedStart) {
    qty = ep.fills[0]?.startPosition ?? 0;
    avg = ep.fills[0]?.px ?? 0;
  }

  for (const bar of candles) {
    while (i < ep.fills.length && ep.fills[i]!.time <= bar.t + 1) {
      const f = ep.fills[i]!;
      const signed = f.side === "B" ? f.sz : -f.sz;
      const growing = Math.abs(qty + signed) > Math.abs(qty);

      if (growing) {
        const total = Math.abs(qty) + f.sz;
        avg = total > 0 ? (avg * Math.abs(qty) + f.px * f.sz) / total : f.px;
      } else {
        realized += f.closedPnl;
      }
      if (f.feeToken === "USDC") fees += f.fee;
      qty += signed;
      i += 1;
    }

    // Signed quantity means this expression is already correct for a short.
    const unrealized = qty * (bar.c - avg);
    points.push({
      t: bar.t,
      qty,
      price: bar.c,
      realized,
      unrealized,
      total: realized + unrealized,
      fees,
    });
  }

  const totals = points.map((p) => p.total);
  const peak = totals.length ? Math.max(...totals) : 0;
  const trough = totals.length ? Math.min(...totals) : 0;

  return {
    coin: ep.coin,
    label,
    wallet,
    side: ep.side,
    interval,
    candles,
    fills: ep.fills,
    points,
    avgEntry: ep.avgEntry,
    realized: ep.realized,
    fees: ep.fees,
    net: ep.net,
    peak,
    trough,
    roe: ep.peakNotional > 0 ? ep.net / ep.peakNotional : 0,
    liquidated: ep.liquidated,
    open: ep.open,
    truncatedStart: ep.truncatedStart,
  };
}
