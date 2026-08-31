/**
 * Fetch a venue URL, from the browser if CORS allows, otherwise through our proxy.
 *
 * Hyperliquid answers `access-control-allow-origin: *`, so the visitor's own IP
 * spends the quota. Lighter and dYdX and Jupiter do the same. Pacifica and RiseX
 * do not send CORS, so a direct browser call never succeeds — it only burns a
 * failed request, then the same-origin `/api/x/{venue}` proxy. Those two go
 * through the proxy first. A 429 still waits and retries; it does not dump a
 * red banner on the first throttle.
 *
 * The proxy still shares one server IP. That is the Hyperliquid-scaling problem
 * we refuse for the book everybody actually uses. For the others it is how they
 * get on the page at all.
 */

import type { VenueId } from "./venue";

export const ORIGIN: Record<VenueId, string> = {
  hyperliquid: "https://api.hyperliquid.xyz",
  lighter: "https://mainnet.zklighter.elliot.ai",
  risex: "https://api.rise.trade",
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

/** No CORS, or CORS that has gone missing after a host move. Do not even try the origin. */
const PROXY_FIRST: ReadonlySet<VenueId> = new Set(["pacifica", "risex", "drift"]);

function join(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/$/, "")}${p}`;
}

function viaProxy(id: VenueId, path: string): string {
  return `/api/x/${id}?u=${encodeURIComponent(path)}`;
}

export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5_000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 5_000);
  return 0;
}

async function pull(
  id: VenueId,
  path: string,
  opts: { signal?: AbortSignal; origin?: string } = {},
): Promise<Response> {
  const onServer = typeof window === "undefined";
  const origin = opts.origin ?? ORIGIN[id];
  const url = join(origin, path);

  if (!onServer && PROXY_FIRST.has(id) && !opts.origin) {
    return fetch(viaProxy(id, path), { signal: opts.signal, cache: "no-store" });
  }

  try {
    const res = await fetch(url, { signal: opts.signal, cache: "no-store" });
    if (!onServer && res.status === 429 && id !== "hyperliquid") {
      return fetch(viaProxy(id, path), { signal: opts.signal, cache: "no-store" });
    }
    return res;
  } catch (err) {
    if (onServer) throw err;
    return fetch(viaProxy(id, path), { signal: opts.signal, cache: "no-store" });
  }
}

/** One in-flight Pacifica/RiseX call at a time in this JS realm, so a walk cannot burst. */
const gate: Partial<Record<VenueId, Promise<unknown>>> = {};

function locked<T>(id: VenueId, fn: () => Promise<T>): Promise<T> {
  if (!PROXY_FIRST.has(id)) return fn();
  const run = (gate[id] ?? Promise.resolve()).then(fn, fn);
  gate[id] = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function json<T>(
  id: VenueId,
  path: string,
  opts: { signal?: AbortSignal; origin?: string } = {},
): Promise<T> {
  return locked(id, async () => {
    const attempts = 5;
    for (let i = 0; i < attempts; i += 1) {
      const res = await pull(id, path, opts);
      if (res.status === 429 && i < attempts - 1) {
        const pause = retryAfterMs(res) || 400 * 2 ** i;
        try {
          await res.body?.cancel();
        } catch {
          /* already consumed */
        }
        await wait(pause, opts.signal);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${id} ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
      }
      return (await res.json()) as T;
    }
    throw new Error(`${id} 429`);
  });
}
