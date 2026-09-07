/**
 * Which bars carry arrows — and therefore which bars carry fill sounds.
 *
 * A TWAP is one order. Its slices fold into a single mark on the bar that did
 * the most size, labeled with the whole notional, so a hundred prints do not
 * become a hundred arrows.
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
type Agg = { buy: number; sell: number; liq: boolean };

function add(cell: Agg, side: "A" | "B", usd: number, liq: boolean): Agg {
  if (side === "B") cell.buy += usd;
  else cell.sell += usd;
  if (liq) cell.liq = true;
  return cell;
}

/** The arrows the chart will draw, oldest bar first, buy before sell on the same bar. */
export function marksOn(data: Tape): Mark[] {
  const me = data.wallet;
  const byBar = new Map<number, Agg>();
  const twapBars = new Map<number, Map<number, Agg>>();

  for (const f of data.fills) {
    const b = Math.max(0, barOf(data.candles, f.time));
    const usd = f.sz * f.px;
    const liq = !!(f.liquidatedUser && sameIdentity(f.liquidatedUser, me));
    if (f.twapId != null) {
      let bars = twapBars.get(f.twapId);
      if (!bars) {
        bars = new Map();
        twapBars.set(f.twapId, bars);
      }
      bars.set(b, add(bars.get(b) ?? { buy: 0, sell: 0, liq: false }, f.side, usd, liq));
    } else {
      byBar.set(b, add(byBar.get(b) ?? { buy: 0, sell: 0, liq: false }, f.side, usd, liq));
    }
  }

  for (const bars of twapBars.values()) {
    let tot: Agg = { buy: 0, sell: 0, liq: false };
    let peakBar = 0;
    let peakMoved = -1;
    for (const [bar, cell] of bars) {
      tot = add(tot, "B", cell.buy, cell.liq);
      tot = add(tot, "A", cell.sell, false);
      const moved = cell.buy + cell.sell;
      if (moved > peakMoved || (moved === peakMoved && bar > peakBar)) {
        peakMoved = moved;
        peakBar = bar;
      }
    }
    const cell = byBar.get(peakBar) ?? { buy: 0, sell: 0, liq: false };
    cell.buy += tot.buy;
    cell.sell += tot.sell;
    cell.liq = cell.liq || tot.liq;
    byBar.set(peakBar, cell);
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
