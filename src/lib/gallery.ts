import "server-only";
import { recentTrades } from "./hl";

/**
 * Wallets that traded in the last few minutes.
 *
 * The cold-start problem, solved without indexing anything. `recentTrades` names both
 * sides of every print, so sampling a handful of busy markets produces a continuous
 * supply of real, currently-active addresses.
 *
 * The alternative is the leaderboard file at stats-data.hyperliquid.xyz, which is
 * multiple megabytes and timed out twice on a cold connection while this was being
 * written. It is the better ranking and the worse dependency; this is the one that
 * always answers.
 */

const DEFAULT_COINS = ["BTC", "ETH", "SOL", "HYPE"];

export interface LiveWallet {
  address: string;
  coin: string;
  /** Size of the print this address was seen on, in USD. */
  notional: number;
}

/** Addresses that are venue plumbing rather than traders worth replaying. */
const IGNORE = new Set<string>([
  // The HLP vault and its liquidator component are on the other side of a great many
  // prints, and a replay of the house is not what anyone came for.
  "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
  "0x2e3d94f0562703b25c83308a05046ddaf9a8dd14",
]);

export async function liveWallets(limit = 9): Promise<LiveWallet[]> {
  const coins = (process.env.RUNBACK_GALLERY_COINS ?? DEFAULT_COINS.join(","))
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const seen = new Map<string, LiveWallet>();

  const batches = await Promise.allSettled(
    coins.map((coin) => recentTrades(coin)),
  );

  for (const batch of batches) {
    if (batch.status !== "fulfilled") continue;
    for (const print of batch.value) {
      const notional = print.px * print.sz;
      for (const address of print.users) {
        const key = address.toLowerCase();
        if (IGNORE.has(key)) continue;
        const existing = seen.get(key);
        // Keep the biggest print an address was seen on; it is the better hook.
        if (!existing || notional > existing.notional) {
          seen.set(key, { address: key, coin: print.coin, notional });
        }
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.notional - a.notional).slice(0, limit);
}
