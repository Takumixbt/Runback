/**
 * Live marks for the ticker.
 *
 * Two calls, because Hyperliquid's markets live in two places: the canonical perps are in
 * `meta`, and the HIP-3 builder markets (the equities and commodities, MU, SNDK, NVDA,
 * gold, crude) are under their deployer's own dex and only answer when you name it.
 * `allDexsAssetCtxs` sounds like it would do both and returns 422.
 *
 * Read from the browser like everything else a visitor triggers, so the polling spends
 * their rate limit rather than one shared server budget.
 */

import { INFO } from "./hl";

const n = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

interface Ctx {
  markPx: string;
  prevDayPx: string;
  dayNtlVlm: string;
}

interface Universe {
  name: string;
  isDelisted?: boolean;
}

export interface Mark {
  /** What the API calls it: "BTC" or "xyz:MU". */
  coin: string;
  /** What a person calls it: "BTC" or "MU". */
  label: string;
  px: number;
  /** Fraction, not percent. Positive is up on the day. */
  change: number;
  vlm: number;
  equity: boolean;
}

async function ctxs(dex?: string): Promise<Mark[]> {
  const res = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hyperliquid ${res.status}`);
  const [meta, list] = (await res.json()) as [{ universe: Universe[] }, Ctx[]];

  // A rejected read answers 200 with an error object, not the two-element tuple.
  // Reaching straight for `.universe.forEach` on that throws a TypeError, which in the
  // ticker meant one bad poll blanked the marks instead of keeping the last good ones.
  if (!Array.isArray(meta?.universe) || !Array.isArray(list)) return [];

  const out: Mark[] = [];
  meta.universe.forEach((asset, i) => {
    const c = list[i];
    if (!c || asset.isDelisted) return;
    const px = n(c.markPx);
    const prev = n(c.prevDayPx);
    if (px <= 0 || prev <= 0) return;
    const vlm = n(c.dayNtlVlm);
    // A market with no volume today has a stale mark and nothing to say.
    if (vlm <= 0) return;
    out.push({
      coin: asset.name,
      label: asset.name.includes(":") ? asset.name.split(":")[1]! : asset.name,
      px,
      change: (px - prev) / prev,
      vlm,
      equity: asset.name.includes(":"),
    });
  });
  return out;
}

/**
 * The ticker's contents: the busiest crypto perps and the busiest equity perps.
 *
 * Ranked by the day's notional volume rather than curated, so the list maintains itself:
 * whatever people are actually trading is what scrolls past. Both groups are taken
 * separately so a quiet day in equities cannot push them off entirely, which is half the
 * point of showing them.
 */
export interface Board {
  marks: Mark[];
}

export async function board(crypto = 14, equities = 8): Promise<Board> {
  const [main, xyz] = await Promise.allSettled([ctxs(), ctxs("xyz")]);

  const byVolume = (a: Mark, b: Mark) => b.vlm - a.vlm;
  const top = (r: PromiseSettledResult<Mark[]>, k: number) =>
    r.status === "fulfilled" ? [...r.value].sort(byVolume).slice(0, k) : [];

  return {
    marks: [...top(main, crypto), ...top(xyz, equities)].sort(byVolume),
  };
}
