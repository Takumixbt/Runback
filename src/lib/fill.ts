/**
 * Turn a venue's own tape into the fill shape `episodes()` already knows.
 *
 * Hyperliquid hands us startPosition, dir and closedPnl on every print. Nobody else
 * does all three, so the adapters walk a list of legs, keep a running size per market
 * and fill those fields in. The fold is the same one Hyperliquid's API has already
 * done for us there: adding to a position updates the average, reducing it realises
 * (price − avg) × closed size, with the sign of the side that was held.
 *
 * When the venue already computed PnL, that number wins. Ours is a fallback so a book
 * that only reports price and size still produces a catalogue with real figures.
 */

import type { Fill } from "./hl";

const FLAT = 1e-9;

export interface Leg {
  coin: string;
  px: number;
  sz: number;
  /** True = buy = Hyperliquid `B`. */
  buy: boolean;
  time: number;
  fee: number;
  hash: string;
  tid: number;
  liquidated?: boolean;
  /** Venue-computed realised PnL for this print, when it has one. */
  closedPnl?: number;
  feeToken?: string;
}

function dirOf(before: number, after: number): string {
  if (before > FLAT && after < -FLAT) return "Long > Short";
  if (before < -FLAT && after > FLAT) return "Short > Long";
  if (Math.abs(after) >= Math.abs(before) - FLAT) {
    return after >= 0 ? "Open Long" : "Open Short";
  }
  return before >= 0 ? "Close Long" : "Close Short";
}

/**
 * Oldest first. Running state is per coin, so a wallet that is long BTC and short
 * ETH in the same minute is two independent positions, which is how the catalogue
 * already thinks.
 */
export function fillsFromLegs(legs: Leg[], subject?: string): Fill[] {
  const ordered = [...legs].sort((a, b) => a.time - b.time || a.tid - b.tid);
  const pos = new Map<string, { qty: number; avg: number }>();
  const me = subject ?? null;
  const out: Fill[] = [];

  for (const leg of ordered) {
    const state = pos.get(leg.coin) ?? { qty: 0, avg: 0 };
    const before = state.qty;
    const signed = leg.buy ? leg.sz : -leg.sz;
    const after = before + signed;
    /**
     * One fill can cross zero: long 10, sell 25, now short 15.
     *
     * That is two events wearing one print. It closes the whole held side at this
     * price and opens the remainder on the other side at the same price. Judged only
     * by size it looks like growth, `|after| > |before|`, so it used to take the
     * adding branch: the close realised nothing and the new short inherited a cost
     * basis blended from the long it replaced. Both numbers were then wrong for
     * every fill after it.
     */
    const flip = before * after < 0;
    const reducing = !flip && Math.abs(after) < Math.abs(before) - FLAT;
    let closedPnl = leg.closedPnl;
    if (closedPnl === undefined) {
      closedPnl = 0;
      if (flip) {
        closedPnl = (leg.px - state.avg) * Math.abs(before) * Math.sign(before);
      } else if (reducing && Math.abs(before) > FLAT) {
        const closed = Math.min(leg.sz, Math.abs(before));
        closedPnl = (leg.px - state.avg) * closed * Math.sign(before);
      }
    }
    if (flip) {
      state.avg = leg.px;
    } else if (Math.abs(after) > Math.abs(before) + FLAT) {
      const added = leg.sz;
      const held = Math.abs(before);
      state.avg = held + added > 0 ? (state.avg * held + leg.px * added) / (held + added) : leg.px;
    }
    if (Math.abs(after) < FLAT) {
      state.qty = 0;
      state.avg = 0;
    } else {
      state.qty = after;
    }
    pos.set(leg.coin, state);

    out.push({
      coin: leg.coin,
      px: leg.px,
      sz: leg.sz,
      side: leg.buy ? "B" : "A",
      time: leg.time,
      startPosition: before,
      dir: dirOf(before, after),
      closedPnl,
      fee: leg.fee,
      feeToken: leg.feeToken ?? "USDC",
      crossed: true,
      hash: leg.hash,
      tid: leg.tid,
      twapId: null,
      liquidatedUser: leg.liquidated && me ? me : null,
    });
  }
  return out;
}
