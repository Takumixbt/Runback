import "server-only";
import { unstable_cache } from "next/cache";
import { fills, labelFor, markets, recentTrades, type Market } from "./hl";
import { episodes, pickWindow } from "./episodes";

/**
 * Trades you can watch right now, found without indexing anything.
 *
 * The first version of this listed wallets straight off the tape, and it was useless in a
 * way worth writing down. Every print on Hyperliquid names BOTH sides of the fill, so the
 * list came out in pairs: two addresses, same coin, same figure, over and over, because
 * they were the buyer and the seller of one trade. It looked broken because it was, and
 * even deduplicated it only ever said "here is an address that traded", which is not a
 * reason to click anything.
 *
 * So the tape is now used for what it is good at, which is finding CANDIDATES, and each
 * candidate is then asked the only question that matters: what is the best position you
 * closed recently, and can it still be drawn? Rows that cannot answer are dropped. What
 * survives is a short list of real, finished, replayable trades with a number on each.
 *
 * The cost is one `userFills` call per candidate, on a 60-second server cache. That is the
 * one place in this app where reading server-side is correct: it is shared work, done once
 * for everybody, rather than a visitor spending their own quota on somebody else's wallet.
 */

const DEFAULT_COINS = ["BTC", "ETH", "SOL", "HYPE"];

/** Candidates to inspect. More than this and the cache refresh gets slow. */
const CANDIDATES = 10;

/** How far back to look for a closed position worth showing. */
const LOOKBACK_MS = 36 * 3_600_000;

export interface Featured {
  wallet: string;
  coin: string;
  label: string;
  side: "LONG" | "SHORT" | "FLIP";
  /** Realised minus USDC fees. */
  net: number;
  /** Against the largest position held. */
  roe: number;
  closedAt: number;
  heldMs: number;
  liquidated: boolean;
  bars: number;
  interval: string;
}

/**
 * Addresses that are venue plumbing rather than traders worth replaying.
 *
 * HLP and its liquidator vault are the counterparty to an enormous share of prints, so
 * without this they would be most of the list, and a replay of the house is not what
 * anyone came for.
 */
const IGNORE = new Set<string>([
  "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
  "0x2e3d94f0562703b25c83308a05046ddaf9a8dd14",
  "0x010461c14e146ac35fe42271bdc1134ee31c703a",
  "0x31ca8395cf837de08b24da3f660e77761dfb974b",
]);

/** Too small to be interesting, and small positions make dull charts. */
const MIN_NET = 25;

async function candidates(): Promise<string[]> {
  const coins = (process.env.RUNBACK_GALLERY_COINS ?? DEFAULT_COINS.join(","))
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const batches = await Promise.allSettled(coins.map((coin) => recentTrades(coin)));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const batch of batches) {
    if (batch.status !== "fulfilled") continue;
    for (const print of batch.value) {
      /**
       * One side per print, not both.
       *
       * Taking both is what produced the duplicate pairs. Which side is arbitrary, and
       * arbitrary is fine: the other side of a busy market is usually a maker who will
       * appear again on its own print anyway.
       */
      const address = print.users[0]?.toLowerCase();
      if (!address || IGNORE.has(address) || seen.has(address)) continue;
      seen.add(address);
      out.push(address);
      if (out.length >= CANDIDATES) return out;
    }
  }
  return out;
}

async function bestPlay(
  wallet: string,
  known: Map<string, Market>,
  now: number,
): Promise<Featured | null> {
  let raw;
  try {
    raw = await fills(wallet, now - LOOKBACK_MS, now, { maxPages: 1 });
  } catch {
    return null;
  }
  if (raw.length === 0) return null;

  for (const ep of episodes(raw)) {
    if (ep.open || ep.truncatedStart) continue;
    if (Math.abs(ep.net) < MIN_NET) continue;
    const w = pickWindow(ep.start, ep.end, now);
    if (!w) continue;
    return {
      wallet,
      coin: ep.coin,
      label: labelFor(ep.coin, known),
      side: ep.side,
      net: ep.net,
      roe: ep.peakNotional > 0 ? ep.net / ep.peakNotional : 0,
      closedAt: ep.end,
      heldMs: ep.end - ep.start,
      liquidated: ep.liquidated,
      bars: w.bars,
      interval: w.interval,
    };
  }
  return null;
}

/**
 * Cached around the work, not around the page.
 *
 * The page itself renders dynamically, so page-level `revalidate` does not stop this from
 * running per request. Caching the data means one visitor a minute pays for the fan-out
 * and everybody else is served from memory, which is the whole justification for doing
 * this on the server rather than in the browser like everything else.
 */
export const featured = unstable_cache(
  (limit = 6) => build(limit),
  ["runback:featured"],
  { revalidate: 60 },
);

async function build(limit: number): Promise<Featured[]> {
  const now = Date.now();

  let known: Map<string, Market>;
  try {
    known = await markets();
  } catch {
    known = new Map();
  }

  const wallets = await candidates();
  const settled = await Promise.allSettled(
    wallets.map((w) => bestPlay(w, known, now)),
  );

  const found = settled
    .map((s) => (s.status === "fulfilled" ? s.value : null))
    .filter((f): f is Featured => f !== null);

  /**
   * A liquidation first if there is one, then by size.
   *
   * Not purely by size. A blown position is the thing people actually watch, and it is
   * rare enough in a sample this small that it should not have to out-earn a good trade
   * to make the list.
   */
  return found
    .sort((a, b) => {
      if (a.liquidated !== b.liquidated) return a.liquidated ? -1 : 1;
      return Math.abs(b.net) - Math.abs(a.net);
    })
    .slice(0, limit);
}
