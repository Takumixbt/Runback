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
import { barOf, buildReplay, episodes, heldMs, settledNet, settledRoe, stillHeld } from "@/lib/episodes";
import type { Candle, Fill } from "@/lib/hl";
import { returnOf } from "@/lib/format";
import { n } from "@/lib/adapter";
import { candlesFrom } from "@/lib/venues/lighter";
import { cuesByBar, marksOn, MAX_MARKERS } from "@/lib/marks";
import { LOOKAHEAD, nextCueTime, SPACING } from "@/lib/sound";

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

  test("an open short's settled net marks to market after fees", () => {
    // Sell 10 @ 100, sell 5 @ 100, still short. Fees 8. Last print 90 → +150 mark,
    // minus fees. Catalogue `net` is minus fees, which is the PONS-style lie.
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: false, time: 1_000, fee: 5 }),
      leg({ px: 100, sz: 5, buy: false, time: 2_000, fee: 3 }),
    ]);
    const ep = episodes(fills, "me")[0]!;
    assert.equal(ep.open, true);
    assert.equal(ep.side, "SHORT");
    assert.ok(Math.abs(ep.net + 8) < 1e-9, `catalogue net ${ep.net}`);

    const replay = buildReplay(
      ep,
      [bar(1_000, 100), bar(2_000, 90)],
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );
    const last = replay.points.at(-1)!;
    assert.ok(Math.abs(last.qty + 15) < 1e-9);
    assert.ok(Math.abs(last.unrealized - 150) < 1e-6);
    assert.ok(Math.abs(replay.net + 8) < 1e-9, "stored net stays realised − fees");
    assert.ok(Math.abs(settledNet(replay) - 142) < 1e-6, `settled ${settledNet(replay)}`);
    assert.equal(settledRoe(replay), returnOf(142, ep.peakNotional));
  });

  test("a closed trade's settled net is still realised minus fees", () => {
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 1_000, fee: 2 }),
      leg({ px: 120, sz: 10, buy: false, time: 2_000, fee: 2 }),
    ]);
    const replay = buildReplay(
      episodes(fills, "me")[0]!,
      [bar(1_000, 100), bar(2_000, 120)],
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );
    assert.equal(replay.open, false);
    assert.ok(Math.abs(replay.net - 196) < 1e-6);
    assert.equal(settledNet(replay), replay.net);
    assert.equal(settledRoe(replay), replay.roe);
  });

  test("a fill inside a bar folds on that bar, with the arrow", () => {
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: false, time: 30_000 }),
    ]);
    const candles = [bar(0, 100), bar(60_000, 100), bar(120_000, 90)];
    const replay = buildReplay(
      episodes(fills, "me")[0]!,
      candles,
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );
    assert.equal(barOf(candles, 30_000), 0);
    assert.ok(Math.abs((replay.points[0]?.qty ?? 0) + 10) < 1e-9, "size on bar 0");
    assert.ok(Math.abs((replay.points[1]?.qty ?? 0) + 10) < 1e-9);
    const marks = marksOn(replay);
    assert.ok(marks.some((m) => m.bar === 0 && !m.isBuy));
  });

  test("an idle cut still marks to market after fees", () => {
    const hour = 3_600_000;
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: false, time: 1_000, fee: 5 }),
      leg({ px: 90, sz: 1, buy: false, time: 1_000 + 7 * hour, fee: 1 }),
    ]);
    const eps = episodes(fills, "me");
    const idle = eps.find((e) => e.truncatedEnd);
    assert.ok(idle, "never-flat tape splits on idle");
    assert.equal(idle!.open, false);
    const replay = buildReplay(
      idle!,
      [bar(1_000, 100), bar(120_000, 80)],
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );
    assert.equal(replay.truncatedEnd, true);
    assert.equal(stillHeld(replay), true);
    const last = replay.points.at(-1)!;
    assert.ok(Math.abs(last.qty + 10) < 1e-9);
    assert.ok(Math.abs(last.unrealized - 200) < 1e-6);
    assert.ok(Math.abs(settledNet(replay) - 195) < 1e-6);
  });

  test("a truncated start's entry matches the fold's inherited basis", () => {
    const fills: Fill[] = [
      {
        coin: "TEST",
        px: 50,
        sz: 1,
        side: "A",
        time: 1_000,
        startPosition: -1000,
        dir: "Open Short",
        closedPnl: 0,
        fee: 0,
        feeToken: "USDC",
        crossed: true,
        hash: "h1",
        tid: 1,
        twapId: null,
        liquidatedUser: null,
      },
      {
        coin: "TEST",
        px: 60,
        sz: 1,
        side: "A",
        time: 2_000,
        startPosition: -1001,
        dir: "Open Short",
        closedPnl: 0,
        fee: 0,
        feeToken: "USDC",
        crossed: true,
        hash: "h2",
        tid: 2,
        twapId: null,
        liquidatedUser: null,
      },
    ];
    const ep = episodes(fills, "me")[0]!;
    assert.equal(ep.truncatedStart, true);
    const expected = (1000 * 50 + 1 * 50 + 1 * 60) / 1002;
    assert.ok(Math.abs(ep.avgEntry - expected) < 1e-6, `entry ${ep.avgEntry}`);
    const replay = buildReplay(
      ep,
      [bar(1_000, 50), bar(2_000, 60)],
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );
    assert.ok(Math.abs(replay.avgEntry - expected) < 1e-6);
    const last = replay.points.at(-1)!;
    assert.ok(Math.abs(last.qty + 1002) < 1e-6);
  });

  test("held is the fill span, not the padded candles", () => {
    const fills = fillsFromLegs([
      leg({ px: 100, sz: 10, buy: true, time: 10_000 }),
      leg({ px: 120, sz: 10, buy: false, time: 70_000 }),
    ]);
    const replay = buildReplay(
      episodes(fills, "me")[0]!,
      [bar(0, 100), bar(60_000, 110), bar(120_000, 120)],
      "TEST",
      "me",
      "1m",
      "hyperliquid",
    );
    assert.equal(heldMs(replay), 60_000);
  });
});

describe("Lighter candles", () => {
  test("the envelope names the array `c`, not `candles`", () => {
    // Watching any Lighter row returned 0 bars: we read `candlesticks` / `candles`
    // and the live body uses `c`. Same letter as close on each bar.
    const bar = { t: 1_767_700_500_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 };
    const fromC = candlesFrom({ code: 200, r: "1h", c: [bar] });
    assert.equal(fromC.length, 1);
    assert.equal(fromC[0]?.t, bar.t);
    assert.equal(fromC[0]?.c, 1.5);
    assert.equal(candlesFrom({ candlesticks: [bar], candles: [bar] }).length, 1);
    assert.equal(candlesFrom({ code: 200, r: "1h" }).length, 0);
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

describe("marks and soundtrack", () => {
  const wallet = "0xabc";
  const print = (over: {
    time: number;
    side: "A" | "B";
    sz: number;
    liq?: boolean;
  }): Fill => ({
    coin: "TEST",
    px: 100,
    sz: over.sz,
    side: over.side,
    time: over.time,
    startPosition: 0,
    dir: over.side === "B" ? "Open Long" : "Close Long",
    closedPnl: 0,
    fee: 0,
    feeToken: "USDC",
    crossed: true,
    hash: "h",
    tid: over.time,
    twapId: null,
    liquidatedUser: over.liq ? wallet : null,
  });

  const tape = (nBars: number, fills: Fill[]) => ({
    wallet,
    fills,
    candles: Array.from({ length: nBars }, (_, i) =>
      bar((i + 1) * 60_000, 100),
    ),
  });

  test("a buy arrow is a buy cue, and a sell too small to mark is silent", () => {
    // 50 sell bars of increasing size, plus one large buy. Forty marks, the
    // tiny sells dropped. The soundtrack has to agree: no till without an arrow,
    // and that buy is not silent.
    const nBars = 50;
    const fills = Array.from({ length: nBars }, (_, i) =>
      print({
        time: (i + 1) * 60_000,
        side: i === nBars - 1 ? "B" : "A",
        sz: i + 1,
      }),
    );
    const data = tape(nBars, fills);
    const marks = marksOn(data);
    const cues = cuesByBar(marks, nBars);

    assert.equal(new Set(marks.map((m) => m.bar)).size, MAX_MARKERS);
    for (let b = 0; b < nBars; b += 1) {
      const marked = marks.filter((m) => m.bar === b);
      assert.deepEqual(
        cues[b],
        marked.map((m) => (m.isBuy ? "buy" : "sell")),
      );
    }
    assert.ok((cues[0]?.length ?? 0) === 0, "the smallest sell must not ding");
    assert.deepEqual(cues[nBars - 1], ["buy"]);
  });

  test("a $10k fill still gets an arrow next to $50k ones", () => {
    const nBars = 50;
    const fills = [
      ...Array.from({ length: nBars }, (_, i) =>
        print({ time: (i + 1) * 60_000, side: "A", sz: 500 }),
      ),
      print({ time: (nBars + 1) * 60_000, side: "B", sz: 100 }),
    ];
    const data = tape(nBars + 1, fills);
    const marks = marksOn(data);
    const ten = marks.find((m) => m.isBuy);
    assert.ok(ten, "the $10k buy must keep its arrow");
    assert.ok(Math.abs(ten!.usd - 10_000) < 1e-6, `buy notional ${ten?.usd}`);
    assert.equal(new Set(marks.map((m) => m.bar)).size, nBars + 1);
  });

  test("a bar that bought and sold carries both cues, a liquidation only the thud", () => {
    const data = tape(3, [
      print({ time: 60_000, side: "B", sz: 10 }),
      print({ time: 60_000, side: "A", sz: 8 }),
      print({ time: 120_000, side: "A", sz: 0.01, liq: true }),
    ]);
    const marks = marksOn(data);
    const cues = cuesByBar(marks, 3);
    assert.deepEqual(cues[0], ["buy", "sell"]);
    assert.deepEqual(cues[1], ["liquidation"]);
  });

  test("a TWAP is one arrow on its busiest bar, not a ping on every slice", () => {
    const nBars = 24;
    const fills = Array.from({ length: nBars }, (_, i) =>
      print({ time: (i + 1) * 60_000, side: "B", sz: i === 11 ? 40 : 5 }),
    ).map((f) => ({ ...f, twapId: 7 }));
    const data = tape(nBars, fills);
    const marks = marksOn(data);
    const cues = cuesByBar(marks, nBars);
    assert.equal(marks.length, 1, "one order, one arrow");
    assert.equal(marks[0]?.bar, 11);
    assert.ok(Math.abs(marks[0]!.usd - 155 * 100) < 1e-6, `folded notional ${marks[0]?.usd}`);
    for (let b = 0; b < nBars; b += 1) {
      if (b === 11) assert.deepEqual(cues[b], ["buy"]);
      else assert.deepEqual(cues[b], []);
    }
  });

  test("a buy and a sell in the same instant both get a slot; nothing is dropped", () => {
    const now = 4.2;
    const first = nextCueTime(now, Number.NEGATIVE_INFINITY);
    const second = nextCueTime(now, first);
    const third = nextCueTime(now, second);

    assert.ok(first >= now + LOOKAHEAD, "live cues sit ahead of currentTime");
    assert.ok(second - first >= SPACING - 1e-9, "the second arrow still rings");
    assert.ok(third - second >= SPACING - 1e-9, "a skipped-frame burst stays audible");
    assert.equal(nextCueTime(now + 1, first), now + 1 + LOOKAHEAD);
  });
});
