/**
 * Which bars carry arrows — and therefore which bars carry fill sounds.
 */

import { barOf, type Replay } from "./episodes";
import type { Cue } from "./sound";
import { sameIdentity } from "./venue";

/** Cap on bars below `MARK_FLOOR`. Liquidations and $10k+ fills are never dropped. */
export const MAX_MARKERS = 40;

/** A bar that moved this much notional always keeps its arrow, even on a busy tape. */
export const MARK_FLOOR = 10_000;

export interface Mark {
  bar: number;
  isBuy: boolean;
  liq: boolean;
  usd: number;
}

type Tape = Pick<Replay, "candles" | "fills" | "wallet">;

/** The arrows the chart will draw, oldest bar first, buy before sell on the same bar. */
export function marksOn(data: Tape): Mark[] {
  const me = data.wallet;

  const byBar = new Map<number, { buy: number; sell: number; liq: boolean }>();
  for (const f of data.fills) {
    const b = Math.max(0, barOf(data.candles, f.time));
    const cell = byBar.get(b) ?? { buy: 0, sell: 0, liq: false };
    if (f.side === "B") cell.buy += f.sz * f.px;
    else cell.sell += f.sz * f.px;
    if (f.liquidatedUser && sameIdentity(f.liquidatedUser, me)) cell.liq = true;
    byBar.set(b, cell);
  }

  const scored = [...byBar.entries()].map(([bar, cell]) => ({
    bar,
    cell,
    moved: cell.buy + cell.sell,
  }));
  const keep = new Set<number>();
  const rest: typeof scored = [];
  for (const s of scored) {
    if (s.cell.liq || s.moved >= MARK_FLOOR) keep.add(s.bar);
    else rest.push(s);
  }
  rest
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
