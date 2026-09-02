/**
 * Turning a stream of fills into a list of plays.
 *
 * This is the whole reason Runback can be wallet-first.
 * Solana hands you holdings with no timestamps, so a wallet resolves to a list of
 * TOKENS and you guess which are interesting. Hyperliquid fills carry time, direction
 * and realised PnL, so a wallet resolves to a list of POSITIONS: flat, open, scale,
 * close, flat. Each one has a start, an end and a number, which is exactly the unit
 * a clip wants.
 */

import type { Candle, Fill } from "./hl";
import { returnOf } from "./format";
import { sameIdentity, type VenueId, venue as venueOf } from "./venue";

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
   * Ended on a quiet stretch rather than on the position closing.
   *
   * The size carried on into the next session, so realised PnL here is exact but the
   * position was not actually flat at this point.
   */
  truncatedEnd: boolean;
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
  /** A forced close of this wallet happened somewhere inside this episode. */
  liquidated: boolean;
  /**
   * The position ENDED on a liquidation, rather than merely containing one.
   *
   * The difference is the whole story. A high-leverage trader gets partially liquidated
   * on the way and carries on, so `liquidated` is true for positions that went on to be
   * their best ever: MEASURED, Andrew Tate has 64 liquidation fills across 133 positions
   * and his single most profitable one is among them. Badging that "LIQ" reads as a
   * contradiction, because it is answering a different question than the one being asked.
   *
   * This is the one that means "blown out of the trade".
   */
  closedByLiquidation: boolean;
  /** The position went from long straight to short or back without passing through flat. */
  flipped: boolean;
  /** Volume-weighted average entry, for the side the episode opened on. */
  avgEntry: number;
}

/** Position sizes are summed floats, so "flat" is never exactly zero. */
const FLAT = 1e-9;

/**
 * A quiet stretch long enough to end a position even though the size never reached zero.
 *
 * Flat-to-flat is the right unit for someone who takes a trade and closes it. It produces
 * NOTHING for anyone who is continuously in the market. MEASURED on a HIP-3 equities market
 * maker: 10,740 fills across 43 markets, 911 on NVDA alone, and every single coin still
 * holding size at both ends of the window, so the whole wallet segmented into 43 open
 * positions and zero closed ones. The page for it was empty.
 *
 * Splitting on idle time gives that wallet sessions instead: a run of activity, then six
 * hours of nothing, then the next run. Realised PnL inside a session is still exact,
 * because it is the sum of the exchange's own `closedPnl` over those fills. What is not
 * exact is the position at the edges, which is what `truncatedStart` and `truncatedEnd`
 * are for.
 */
const MAX_IDLE_MS = 6 * 3_600_000;


/**
 * Split one wallet's fills into episodes, best first.
 *
 * A flip (`dir` containing ">") crosses through zero in a single fill and is deliberately
 * NOT treated as two episodes. Splitting there reads tidier in a table and makes a worse
 * clip, and the clip is the product: "he was long, he flipped, it kept going" is one story.
 * The episode is marked `flipped` so the UI can say so.
 */
export function episodes(all: Fill[], subject?: string): Episode[] {
  const me = subject;
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
     * Does this coin's position ever reach flat? Decided BEFORE segmenting, because it
     * decides which rule to segment by, and getting it wrong wrecks ordinary wallets.
     *
     * Splitting on idle time unconditionally was doing exactly that. A position held
     * longer than six hours got cut between its entry and its exit, so the two halves
     * became separate "positions": one carrying every fill and no PnL, the other carrying
     * a single closing fill and all of it. MEASURED on Ansem, that produced an 801-fill
     * HYPE episode worth minus one hundred dollars in fees, and a five-fill episode worth
     * +$258,547 with no entry attached to it. Anyone holding overnight was mangled.
     *
     * Idle-splitting exists for the opposite case: a desk that is never flat and would
     * otherwise segment into nothing. So it is used only where flat genuinely never
     * happens, and a wallet that closes its positions is left alone.
     */
    let probe = list[0]?.startPosition ?? 0;
    let everFlat = false;
    for (const f of list) {
      probe += f.side === "B" ? f.sz : -f.sz;
      if (Math.abs(probe) < FLAT) {
        everFlat = true;
        break;
      }
    }
    const splitOnIdle = !everFlat;

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
    let lastAt = 0;

    for (const f of list) {
      /**
       * Close an open run before booking a fill that arrives after a long silence.
       *
       * Done before the position is updated, so the session ends where the activity
       * actually stopped rather than where it resumed.
       */
      if (splitOnIdle && cur && lastAt > 0 && f.time - lastAt > MAX_IDLE_MS) {
        cur.truncatedEnd = true;
        cur.avgEntry = entryQty > 0 ? entryCost / entryQty : cur.fills[0]!.px;
        cur.net = cur.realized - cur.fees;
        out.push(cur);
        cur = null;
        firstOfCoin = false;
      }

      const signed = f.side === "B" ? f.sz : -f.sz;
      const before = pos;
      pos += signed;
      lastAt = f.time;

      if (!cur) {
        cur = {
          id: `${coin}-${f.tid}`,
          coin,
          side: (Math.abs(before) > FLAT ? before : pos) > 0 ? "LONG" : "SHORT",
          start: f.time,
          end: f.time,
          open: false,
          truncatedEnd: false,
          truncatedStart: firstOfCoin || Math.abs(before) > FLAT,
          fills: [],
          peakSize: 0,
          peakNotional: 0,
          realized: 0,
          fees: 0,
          net: 0,
          liquidated: false,
          closedByLiquidation: false,
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
      /**
       * Only when the SUBJECT was the one liquidated.
       *
       * Both sides of a forced close carry the liquidation object, so without this check
       * the wallet that profitably absorbed somebody else's blow-up is labelled as having
       * been blown up itself. With no subject given, nothing is flagged, which is the safe
       * default: a wrong badge is worse than a missing one.
       */
      if (f.liquidatedUser && me && sameIdentity(f.liquidatedUser, me)) cur.liquidated = true;
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
        // Flat, and the fill that got it there was forced: this is a blow-up.
        cur.closedByLiquidation = !!(f.liquidatedUser && me && sameIdentity(f.liquidatedUser, me));
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

/** Every interval Hyperliquid actually serves, verified against the live endpoint. */
const INTERVALS: { name: string; sec: number }[] = [
  { name: "1m", sec: 60 },
  { name: "3m", sec: 180 },
  { name: "5m", sec: 300 },
  { name: "15m", sec: 900 },
  { name: "30m", sec: 1800 },
  { name: "1h", sec: 3600 },
  { name: "2h", sec: 7200 },
  { name: "4h", sec: 14400 },
  { name: "8h", sec: 28800 },
  { name: "12h", sec: 43200 },
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
const MAX_CANDLES = 5000;

/** Below this a replay is a straight line with two dots on it, so it is not offered. */
export const MIN_BARS = 25;

/**
 * Above this the replay is too long to sit through.
 *
 * The bar count IS the running time: at 600ms a bar, 1,200 bars is twelve minutes. So the
 * interval has to be chosen against how long the video will be, not against how fine the
 * data can get. 260 bars is about two and a half minutes at 1x and half that at 2x, and it
 * is what pushes a two-day hold onto 15m bars and a ten-day one onto hourly, which is how
 * anybody would draw those trades by hand.
 */
const MAX_BARS = 260;

/** Context either side of the trade, so the entry marker is not sitting on bar zero. */
const PAD = 0.15;

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
  const span = end - start;

  for (const { name, sec } of INTERVALS) {
    const step = sec * 1000;

    /**
     * Pad to whichever is larger: a fraction of the trade, or enough bars to be a chart.
     *
     * The fraction alone is why so many rows used to read "no bars left". A three-minute
     * trade padded by 15% is a three-and-a-half-minute window, which is four bars at 1m and
     * one at 5m, so every interval failed the minimum and the row was refused outright.
     * Widening instead shows the trade IN CONTEXT: the same three minutes, with an hour of
     * price either side of it. That is a better chart than the tight one would have been.
     */
    const wanted = MIN_BARS * step;
    const pad = Math.max(span * PAD + step, (wanted - span) / 2);
    const from = Math.floor(start - pad);
    const to = Math.ceil(end + pad);

    // The oldest timestamp this interval can still serve.
    if (from < now - MAX_CANDLES * step) continue;

    const bars = Math.ceil((to - from) / step);
    if (bars > MAX_BARS) continue;
    return { interval: name, sec, from, to, bars };
  }
  return null;
}

/** Why a window could not be found, in words a person can act on. */
export function whyNoWindow(start: number, end: number, now = Date.now()): string {
  const days = Math.round((now - start) / 86_400_000);
  const reachable = INTERVALS.find(({ sec }) => start >= now - MAX_CANDLES * sec * 1000);
  if (!reachable) {
    return `opened ${days} days ago, which is past every interval this venue still serves`;
  }
  return `spans too long to draw inside ${MAX_BARS} bars at any available interval`;
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
  venue: VenueId;
  venueName: string;
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
  /** Return on the peak notional held. Null when that denominator is unusable. */
  roe: number | null;
  liquidated: boolean;
  /** Ended on a forced close, rather than merely containing one. */
  closedByLiquidation: boolean;
  open: boolean;
  truncatedStart: boolean;
}

/**
 * Fold fills onto bars.
 *
 * Two accountings run side by side: the sum of `closedPnl` is order-independent and comes
 * from Hyperliquid, while the average-cost
 * fold is ours and is order-dependent. They should agree at the end of an episode. Where
 * they do not, something was double-counted, usually a TWAP slice or a flip.
 */
export function buildReplay(
  ep: Episode,
  candles: Candle[],
  label: string,
  wallet: string,
  interval: string,
  venueId: VenueId,
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
      const after = qty + signed;
      /**
       * A fill that crosses zero both closes and opens, so it belongs to neither
       * branch alone. Sized against the old position it reads as growth, and the
       * growth branch skips `closedPnl`, so a flip dropped the exchange's own
       * realised number out of the fold entirely: `points` disagreed with
       * `ep.realized` for the rest of the replay, which is the MISMATCH
       * `scripts/check.ts` reconciles for. The residual is a new position at this
       * price, not a blend of the side it replaced.
       */
      const flip = qty * after < 0;

      if (flip) {
        realized += f.closedPnl;
        avg = f.px;
      } else if (Math.abs(after) > Math.abs(qty)) {
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
    venue: venueId,
    venueName: venueOf(venueId)?.name ?? venueId,
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
    roe: returnOf(ep.net, ep.peakNotional),
    liquidated: ep.liquidated,
    closedByLiquidation: ep.closedByLiquidation,
    open: ep.open,
    truncatedStart: ep.truncatedStart,
  };
}
