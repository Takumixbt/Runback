/**
 * Pacifica. Solana CLOB whose trade history is almost Hyperliquid's fill:
 * `open_long` / `close_long`, `pnl`, `fee`, and a liquidation `cause`.
 *
 * GET /api/v1/trades/history?account= answers 200 without a signature (empty
 * list for an unused key). No CORS, so the browser goes through the proxy.
 * History is capped at 30 days per request, so we walk 29-day windows
 * backwards, with a gap: a tight loop 429s. Klines are the same shape as
 * Hyperliquid's snapshot.
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json, wait } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import type { Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

/** Pacifica 429s a burst. One window at a time, with a gap, is what it will serve. */
const GAP_MS = 250;

/**
 * Pacifica is inconsistent about seconds versus milliseconds between endpoints, so
 * both the tape and the klines are normalised through here. They used to disagree:
 * fills were converted and bars were not, which put the two on different time bases
 * and left `buildReplay` assigning every fill to the wrong bar — or to no bar at all.
 */
const asMs = (v: number): number => (v > 1e12 ? v : v * 1000);

const INTERVAL: Record<string, string> = {
  "1m": "1m",
  "3m": "5m",
  "5m": "5m",
  "15m": "15m",
  "30m": "15m",
  "1h": "1h",
  "2h": "1h",
  "4h": "4h",
  "8h": "4h",
  "12h": "4h",
  "1d": "1d",
};

interface Info {
  symbol: string;
  instrument_type?: string;
  base_asset?: string;
}

interface Hist {
  history_id: number;
  order_id?: number;
  symbol: string;
  amount: string;
  price: string;
  fee: string;
  pnl: string;
  side: string;
  created_at: number;
  cause?: string;
}

export const adapter: VenueAdapter = {
  id: "pacifica",
  isAddress: (v) => kindOfAddress(v) === "solana",
  async markets(signal) {
    const raw = await json<{ data: Info[] }>("pacifica", "/api/v1/info", { signal });
    const out = new Map<string, Market>();
    for (const m of raw.data ?? []) {
      const label = m.base_asset ?? m.symbol;
      out.set(m.symbol, { coin: m.symbol, label, kind: "perp" });
    }
    return out;
  },
  async fills(user, startTime, endTime, opts = {}) {
    /** Counted in 29-day windows, not HTTP cursor pages. A busy desk can fill
     * `maxPages` requests inside the latest month and never reach older closes. */
    const maxWindows = opts.maxPages ?? 3;
    const MAX_CURSOR_PER_WINDOW = 8;
    const WINDOW = 29 * 86_400_000;
    const legs: Leg[] = [];
    let windows = 0;
    let windowEnd = endTime;
    let first = true;

    while (windows < maxWindows && windowEnd > startTime) {
      windows += 1;
      const windowStart = Math.max(startTime, windowEnd - WINDOW);
      let cursor: string | undefined;
      let cursorPages = 0;
      do {
        if (!first) await wait(GAP_MS, opts.signal);
        first = false;
        const q = new URLSearchParams({
          account: user,
          start_time: String(windowStart),
          end_time: String(windowEnd),
          limit: "100",
        });
        if (cursor) q.set("cursor", cursor);
        const raw = await json<{
          data: Hist[] | null;
          next_cursor?: string;
          has_more?: boolean;
        }>("pacifica", `/api/v1/trades/history?${q}`, { signal: opts.signal });
        cursorPages += 1;
        const page = raw.data ?? [];
        for (const t of page) {
          const px = n(t.price);
          const sz = n(t.amount);
          if (px <= 0 || sz <= 0 || !t.side) continue;
          const side = t.side.toLowerCase();
          const buy = side.includes("long")
            ? side.startsWith("open")
            : side.startsWith("close");
          const cause = (t.cause ?? "").toLowerCase();
          legs.push({
            coin: t.symbol,
            px,
            sz,
            buy,
            time: asMs(t.created_at),
            fee: Math.abs(n(t.fee)),
            hash: String(t.order_id ?? t.history_id),
            tid: t.history_id,
            liquidated: cause.includes("liquidation"),
            closedPnl: n(t.pnl),
          });
        }
        if (page.length) opts.onPage?.(fillsFromLegs(legs, user));
        cursor = raw.has_more ? raw.next_cursor : undefined;
      } while (cursor && cursorPages < MAX_CURSOR_PER_WINDOW);
      windowEnd = windowStart;
    }
    return fillsFromLegs(legs, user);
  },
  async candles(coin, interval, startTime, endTime, signal) {
    const i = INTERVAL[interval] ?? "1h";
    const raw = await json<{ data: RawBar[] }>(
      "pacifica",
      `/api/v1/kline?symbol=${encodeURIComponent(coin)}&interval=${i}&start_time=${startTime}&end_time=${endTime}`,
      { signal },
    );
    return (raw.data ?? [])
      .map((b) => ({
        t: asMs(n(b.t)),
        o: n(b.o),
        h: n(b.h),
        l: n(b.l),
        c: n(b.c),
        v: n(b.v),
        n: b.n ?? 0,
      }))
      .filter((b) => b.t > 0)
      .sort((a, b) => a.t - b.t);
  },
};

interface RawBar {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n?: number;
}
