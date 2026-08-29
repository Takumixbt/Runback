/**
 * Fetch a venue URL, from the browser if CORS allows, otherwise through our proxy.
 *
 * Hyperliquid answers `access-control-allow-origin: *`, so the visitor's own IP
 * spends the quota. Lighter and dYdX and Jupiter do the same. Pacifica does not:
 * Node can read it, the browser cannot, and a failed CORS check looks like a
 * network error. The same-origin `/api/x/{venue}` route is the fallback for that
 * case, and only that case — we try the real host first.
 *
 * The proxy still shares one server IP. That is the Hyperliquid-scaling problem
 * we refuse for the book everybody actually uses. For the others it is how they
 * get on the page at all.
 */

import type { VenueId } from "./venue";

export const ORIGIN: Record<VenueId, string> = {
  hyperliquid: "https://api.hyperliquid.xyz",
  lighter: "https://mainnet.zklighter.elliot.ai",
  dydx: "https://indexer.dydx.trade",
  drift: "https://data.velocity.exchange",
  pacifica: "https://api.pacifica.fi",
  jupiter: "https://perps-api.jup.ag",
};

/** Drift's API has moved hosts more than once. Try these in order on a miss. */
export const DRIFT_ORIGINS = [
  "https://data.velocity.exchange",
  "https://data.api.drift.trade",
  "https://mainnet-beta.api.drift.trade",
] as const;

function join(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/$/, "")}${p}`;
}

export async function pull(
  id: VenueId,
  path: string,
  opts: { signal?: AbortSignal; origin?: string } = {},
): Promise<Response> {
  const origin = opts.origin ?? ORIGIN[id];
  const url = join(origin, path);
  try {
    const res = await fetch(url, { signal: opts.signal, cache: "no-store" });
    return res;
  } catch (err) {
    if (typeof window === "undefined") throw err;
    const proxied = `/api/x/${id}?u=${encodeURIComponent(path)}`;
    return fetch(proxied, { signal: opts.signal, cache: "no-store" });
  }
}

export async function json<T>(
  id: VenueId,
  path: string,
  opts: { signal?: AbortSignal; origin?: string } = {},
): Promise<T> {
  const res = await pull(id, path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${id} ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}
