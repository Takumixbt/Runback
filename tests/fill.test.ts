/**
 * The fold, on the cases that were wrong.
 *
 * Every test here is a bug that shipped. The interesting failures in this app are all
 * arithmetic on somebody else's tape, and none of them are visible from a screenshot:
 * a flip that realises nothing looks exactly like a flip that realises correctly until
 * you add up the column. `scripts/check.ts` catches these against a live wallet, but
 * only if a live wallet happens to have flipped that week. These do not wait for one.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { fillsFromLegs, type Leg } from "@/lib/fill";
import { buildReplay, episodes } from "@/lib/episodes";
import type { Candle } from "@/lib/hl";
import { n } from "@/lib/adapter";

const leg = (over: Partial<Leg> & { px: number; sz: number; buy: boolean; time: number }): Leg => ({
  coin: "TEST",
  fee: 0,
  hash: `h${over.time}`,
  tid: over.time,
  ...over,
});

const bar = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 0, n: 1 });

describe("fillsFromLegs", () => {
  test("a flip realises the whole side it closed", () => {
    // Long 10 @ 100, then sell 25 @ 110: closes all 10 long and opens 15 short.
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 1_000 }),
      leg({ px: 110, sz: 25, buy: false, time: 2_000 }),
    ]);

    assert.equal(fills[1]?.dir, "Long > Short");
    // (110 - 100) * 10 held long. Previously 0: the fill was read as growth.
    assert.ok(
      Math.abs((fills[1]?.closedPnl ?? 0) - 100) < 1e-9,
      `flip realised ${fills[1]?.closedPnl}, expected 100`,
    );
  });

  test("the side a flip opens is priced at the flip, not blended with the side it replaced", () => {
    // ...then buy 15 @ 105 to close the 15 short opened at 110, for +75.
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 1_000 }),
      leg({ px: 110, sz: 25, buy: false, time: 2_000 }),
      leg({ px: 105, sz: 15, buy: true, time: 3_000 }),
    ]);

    assert.ok(
      Math.abs((fills[2]?.closedPnl ?? 0) - 75) < 1e-9,
      `short leg realised ${fills[2]?.closedPnl}, expected 75 from a 110 basis`,
    );
  });

  test("an ordinary scale-in still averages, and its exit realises against that average", () => {
    // 10 @ 100 and 10 @ 200 average to 150; selling 20 @ 150 is flat.
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 1_000 }),
      leg({ px: 200, sz: 10, buy: true, time: 2_000 }),
      leg({ px: 150, sz: 20, buy: false, time: 3_000 }),
    ]);

    assert.equal(fills[1]?.closedPnl, 0);
    assert.ok(Math.abs(fills[2]?.closedPnl ?? 0) < 1e-9);
  });

  test("a partial close realises only the part it closed", () => {
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 1_000 }),
      leg({ px: 120, sz: 4, buy: false, time: 2_000 }),
    ]);

    assert.ok(Math.abs((fills[1]?.closedPnl ?? 0) - 80) < 1e-9);
  });

  test("a short is signed the other way", () => {
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: false, time: 1_000 }),
      leg({ px: 90, sz: 10, buy: true, time: 2_000 }),
    ]);

    assert.equal(fills[0]?.dir, "Open Short");
    assert.ok(Math.abs((fills[1]?.closedPnl ?? 0) - 100) < 1e-9);
  });

  test("only the subject is ever marked as liquidated", () => {
    const legs = [leg({ px: 100, sz: 1, buy: true, time: 1_000, liquidated: true })];
    assert.equal(fillsFromLegs(legs, "me")[0]?.liquidatedUser, "me");
    // Both sides of a forced close carry the flag, so with no subject nobody is blamed.
    assert.equal(fillsFromLegs(legs)[0]?.liquidatedUser, null);
  });
});

describe("buildReplay", () => {
  /**
   * The reconciliation `scripts/check.ts` runs against a live wallet, as a fixture.
   *
   * `ep.realized` sums the venue's own per-fill number and is order-independent. The
   * fold in `buildReplay` is ours and walks bar by bar. On a closed position they have
   * to agree; a flip used to take the growth branch, which skips `closedPnl` entirely,
   * so the fold silently lost the flip's realised PnL for the rest of the replay.
   */
  test("the bar-by-bar fold agrees with the venue's total across a flip", () => {
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 1_000 }),
      leg({ px: 110, sz: 25, buy: false, time: 2_000 }),
      leg({ px: 105, sz: 15, buy: true, time: 3_000 }),
    ]);

    const eps = episodes(fills, "me");
    assert.equal(eps.length, 1, "one round trip through flat is one episode");
    const ep = eps[0]!;
    assert.equal(ep.side, "FLIP");

    const replay = buildReplay(
      ep,
      [bar(1_000, 100), bar(2_000, 110), bar(3_000, 105)],
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );

    const folded = replay.points.at(-1)?.realized ?? 0;
    assert.ok(
      Math.abs(folded - ep.realized) < 1e-6,
      `fold ${folded} vs venue ${ep.realized}`,
    );
    // 100 on the long, 75 on the short it flipped into.
    assert.ok(Math.abs(ep.realized - 175) < 1e-6, `expected 175, got ${ep.realized}`);
  });

  test("a closed position ends flat", () => {
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 1_000 }),
      leg({ px: 120, sz: 10, buy: false, time: 2_000 }),
    ]);
    const replay = buildReplay(
      episodes(fills, "me")[0]!,
      [bar(1_000, 100), bar(2_000, 120)],
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );

    assert.ok(Math.abs(replay.points.at(-1)?.qty ?? 1) < 1e-6);
    // Flat, so nothing is left to mark to market.
    assert.ok(Math.abs(replay.points.at(-1)?.unrealized ?? 1) < 1e-6);
  });
});

describe("numeric boundary", () => {
  test("a malformed field costs its own row, not the whole catalogue", () => {
    // One NaN reaching a running total turns an episode's PnL, entry and drawdown
    // into NaN, and NaN renders as nothing at all.
    assert.equal(n("n/a"), 0);
    assert.equal(n(undefined), 0);
    assert.equal(n(null), 0);
    assert.equal(n(Infinity), 0);
    assert.equal(n("12.5"), 12.5);
    assert.equal(n(-3), -3);
  });
});
