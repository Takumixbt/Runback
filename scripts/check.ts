/**
 * Prove the pipeline against a live wallet, without a browser.
 *
 * Run with:  node --experimental-strip-types scripts/check.ts [address]
 *
 * Exists because every interesting failure in this app is a data failure: an episode that
 * never closes, a window the candle endpoint silently refuses, a fill counted twice. None
 * of those are visible from a screenshot, and all of them are visible here.
 */

import { candles, fills, isAddress, labelFor, markets, recentTrades } from "../src/lib/hl.ts";
import { buildReplay, episodes, pickWindow, whyNoWindow } from "../src/lib/episodes.ts";

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const rpad = (s: string, n: number) => s.padStart(n);
const money = (v: number) =>
  `${v >= 0 ? "+" : "-"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

async function main() {
  let who = process.argv[2];

  if (!who) {
    // No address given: take a live one off the tape, which is what the gallery does.
    const prints = await recentTrades("HYPE");
    who = prints.find((p) => p.users[0])?.users[0] ?? "";
    console.log(`no address given, picked one off the tape: ${who}\n`);
  }
  if (!isAddress(who)) throw new Error(`not an address: ${who}`);

  const known = await markets();
  const now = Date.now();
  const raw = await fills(who, now - 7 * 86_400_000, now, {
    onPage: (t) => process.stdout.write(`\rreading fills… ${t}`),
  });
  process.stdout.write("\r");

  const eps = episodes(raw);
  const coins = new Set(raw.map((f) => f.coin));

  console.log(`wallet   ${who}`);
  console.log(`fills    ${raw.length} across ${coins.size} markets, last 7 days`);
  console.log(`episodes ${eps.length}\n`);

  console.log(
    pad("MARKET", 12) + pad("SIDE", 6) + pad("HELD", 8) +
      rpad("FILLS", 6) + rpad("NOTIONAL", 14) + rpad("NET", 12) + "  WINDOW",
  );
  console.log("-".repeat(92));

  let drawable = 0;
  for (const ep of eps.slice(0, 15)) {
    const w = pickWindow(ep.start, ep.end, now);
    if (w) drawable += 1;
    const held = ep.open ? "open" : `${((ep.end - ep.start) / 3_600_000).toFixed(1)}h`;
    const flags = [ep.liquidated && "LIQ", ep.flipped && "FLIP", ep.truncatedStart && "CUT"]
      .filter(Boolean)
      .join(" ");
    console.log(
      pad(labelFor(ep.coin, known), 12) +
        pad(ep.side, 6) +
        pad(held, 8) +
        rpad(String(ep.fills.length), 6) +
        rpad(Math.round(ep.peakNotional).toLocaleString("en-US"), 14) +
        rpad(money(ep.net), 12) +
        `  ${w ? `${w.bars} x ${w.interval}` : `none (${whyNoWindow(ep.start, ep.end, now)})`}` +
        (flags ? `  ${flags}` : ""),
    );
  }
  console.log(`\n${drawable}/${Math.min(eps.length, 15)} of the top rows are replayable`);

  /* --------------------------------------------- draw the best one, end to end */

  const best = eps.find((e) => !e.open && pickWindow(e.start, e.end, now));
  if (!best) {
    console.log("\nnothing replayable to draw.");
    return;
  }

  const w = pickWindow(best.start, best.end, now)!;
  const bars = await candles(best.coin, w.interval, w.from, w.to);
  const replay = buildReplay(best, bars, labelFor(best.coin, known), who, w.interval);

  console.log(`\n--- ${replay.label} ${replay.side} ---`);
  console.log(`bars       ${replay.candles.length} x ${replay.interval}`);
  console.log(`points     ${replay.points.length}`);
  console.log(`avg entry  ${replay.avgEntry}`);
  console.log(`realized   ${money(replay.realized)}`);
  console.log(`fees       ${money(-replay.fees)}`);
  console.log(`net        ${money(replay.net)}`);
  console.log(`return     ${(replay.roe * 100).toFixed(2)}%`);
  console.log(`best/worst ${money(replay.peak)} / ${money(replay.trough)}`);

  /**
   * The reconciliation that catches a bad fold.
   *
   * `realized` is the sum of Hyperliquid's own `closedPnl`, which is order-independent.
   * The last point's realized is ours, folded bar by bar in stream order. They have to
   * agree at the end of a closed episode; where they do not, a fill was double-counted or
   * missed, usually a TWAP slice or a flip.
   */
  const ours = replay.points.at(-1)?.realized ?? 0;
  const drift = Math.abs(ours - replay.realized);
  const scale = Math.max(1, Math.abs(replay.realized));
  console.log(
    `\nreconcile  exchange ${money(replay.realized)} vs fold ${money(ours)} ` +
      `-> drift ${drift.toFixed(4)} (${((drift / scale) * 100).toFixed(3)}%)  ` +
      (drift / scale < 0.001 ? "OK" : "MISMATCH"),
  );

  const closed = replay.points.at(-1)?.qty ?? 0;
  console.log(`final qty  ${closed}  ${Math.abs(closed) < 1e-6 ? "OK (flat)" : "NOT FLAT"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
