/**
 * Pacifica. Solana CLOB whose trade history is almost Hyperliquid's fill:
 * `open_long` / `close_long`, `pnl`, `fee`, and a liquidation `cause`.
 *
 * GET /api/v1/trades/history?account= answers 200 without a signature (empty
 * list for an unused key). CORS headers are missing on some paths, so the
 * browser falls through the proxy. History is capped at 30 days per request,
 * so we walk 29-day windows backwards. Klines are the same shape as
 * Hyperliquid's snapshot.
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import type { Candle, Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

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
    const maxPages = opts.maxPages ?? 30;
    /** Pacifica rejects a range longer than 30 days. Stay a day under. */
    const WINDOW = 29 * 86_400_000;
    const legs: Leg[] = [];
    let budget = maxPages;
    let windowEnd = endTime;

    while (budget > 0 && windowEnd > startTime) {
      const windowStart = Math.max(startTime, windowEnd - WINDOW);
      let cursor: string | undefined;
      do {
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
        budget -= 1;
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
            time: t.created_at > 1e12 ? t.created_at : t.created_at * 1000,
            fee: Math.abs(n(t.fee)),
            hash: String(t.order_id ?? t.history_id),
            tid: t.history_id,
            liquidated: cause.includes("liquidation"),
            closedPnl: n(t.pnl),
          });
        }
        if (page.length) opts.onPage?.(fillsFromLegs(legs, user));
        cursor = raw.has_more ? raw.next_cursor : undefined;
      } while (cursor && budget > 0);
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
    return (raw.data ?? []).map((b) => ({
      t: b.t,
      o: n(b.o),
      h: n(b.h),
      l: n(b.l),
      c: n(b.c),
      v: n(b.v),
      n: b.n ?? 0,
    }));
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
