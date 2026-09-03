/**
 * Which bars carry arrows — and therefore which bars carry fill sounds.
 *
 * The live replay and the exporter both used to derive this twice, and they drifted:
 * arrows kept the forty biggest bars (both sides), while the soundtrack dinged every
 * bar that sold and stayed quiet on buys. A buy arrow with no tick, and a tiny sell
 * with a till and no arrow, were the same bug wearing two hats.
 */

import type { Replay } from "./episodes";
import type { Cue } from "./sound";
import { sameIdentity } from "./venue";

/**
 * The most marker-carrying bars a chart will keep, liquidations excepted.
 *
 * Enough to show where a position was built and taken off, few enough that each one is
 * still a separate thing you can look at. A HIP-3 market maker's position can carry 911
 * fills; merged per bar that is still a marker on nearly every bar, which is a ribbon,
 * not an annotation.
 */
export const MAX_MARKERS = 40;

export interface Mark {
  bar: number;
  isBuy: boolean;
  liq: boolean;
  usd: number;
}

type Tape = Pick<Replay, "candles" | "fills" | "wallet">;

/** The arrows the chart will draw, oldest bar first, buy before sell on the same bar. */
export function marksOn(data: Tape): Mark[] {
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

  const pending: Mark[] = [];
  for (const { bar, cell } of scored.filter((s) => keep.has(s.bar))) {
    if (cell.liq) {
      pending.push({ bar, isBuy: cell.buy >= cell.sell, liq: true, usd: cell.buy + cell.sell });
    } else {
      if (cell.buy > 0) pending.push({ bar, isBuy: true, liq: false, usd: cell.buy });
      if (cell.sell > 0) pending.push({ bar, isBuy: false, liq: false, usd: cell.sell });
    }
  }

  return pending.sort((a, b) => a.bar - b.bar || Number(b.isBuy) - Number(a.isBuy));
}

/** One cue per arrow, indexed by bar, so the soundtrack cannot point at a bar the chart did not mark. */
export function cuesByBar(marks: Mark[], bars: number): Cue[][] {
  const out: Cue[][] = Array.from({ length: bars }, () => []);
  for (const m of marks) {
    if (m.bar < 0 || m.bar >= bars) continue;
    out[m.bar]!.push(m.liq ? "liquidation" : m.isBuy ? "buy" : "sell");
  }
  return out;
}
