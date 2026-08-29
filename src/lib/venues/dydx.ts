/**
 * dYdX v4 indexer. Unauthenticated fills and candles, CORS *.
 *
 * Addresses are `dydx1…`, not 0x. Fills have no startPosition; we reconstruct.
 * Subaccount 0 is the default the UI means by "this wallet".
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import type { Candle, Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

const INTERVAL: Record<string, string> = {
  "1m": "1MIN",
  "3m": "5MINS",
  "5m": "5MINS",
  "15m": "15MINS",
  "30m": "30MINS",
  "1h": "1HOUR",
  "2h": "1HOUR",
  "4h": "4HOURS",
  "8h": "4HOURS",
  "12h": "4HOURS",
  "1d": "1DAY",
};

interface RawFill {
  id?: string;
  side: string;
  market?: string;
  ticker?: string;
  price: string;
  size: string;
  fee?: string;
  createdAt: string;
  type?: string;
  orderId?: string;
}

interface RawCandle {
  startedAt: string;
  open: string;
  high: string;
  low: string;
  close: string;
  baseTokenVolume?: string;
  trades?: number;
}

export const adapter: VenueAdapter = {
  id: "dydx",
  isAddress: (v) => kindOfAddress(v) === "dydx",
  async markets(signal) {
    const raw = await json<{ markets: Record<string, { ticker: string; status: string }> }>(
      "dydx",
      "/v4/perpetualMarkets",
      { signal },
    );
    const out = new Map<string, Market>();
    for (const [ticker, m] of Object.entries(raw.markets ?? {})) {
      if (m.status && m.status !== "ACTIVE") continue;
      const label = ticker.replace(/-USD$/, "");
      out.set(ticker, { coin: ticker, label, kind: "perp" });
    }
    return out;
  },
  async fills(user, startTime, endTime, opts = {}) {
    const maxPages = opts.maxPages ?? 20;
    const legs: Leg[] = [];
    let pagePosition: string | undefined;

    for (let i = 0; i < maxPages; i += 1) {
      const q = new URLSearchParams({
        address: user,
        subaccountNumber: "0",
        limit: "100",
      });
      if (pagePosition) q.set("pagePosition", pagePosition);
      const raw = await json<{ fills: RawFill[]; pagePosition?: string }>(
        "dydx",
        `/v4/fills?${q}`,
        { signal: opts.signal },
      );
      const page = raw.fills ?? [];
      if (page.length === 0) break;
      for (const f of page) {
        const time = Date.parse(f.createdAt);
        if (!Number.isFinite(time) || time < startTime || time > endTime) continue;
        const px = n(f.price);
        const sz = n(f.size);
        if (px <= 0 || sz <= 0) continue;
        const coin = f.market ?? f.ticker ?? "";
        if (!coin) continue;
        legs.push({
          coin,
          px,
          sz,
          buy: f.side === "BUY",
          time,
          fee: Math.abs(n(f.fee)),
          hash: f.orderId ?? f.id ?? `${coin}-${time}`,
          tid: time,
          liquidated: (f.type ?? "").toUpperCase().includes("LIQUID"),
        });
      }
      opts.onPage?.(fillsFromLegs(legs, user));
      pagePosition = raw.pagePosition;
      if (!pagePosition || page.length < 100) break;
      const oldest = Date.parse(page[page.length - 1]!.createdAt);
      if (oldest < startTime) break;
    }
    return fillsFromLegs(legs, user);
  },
  async candles(coin, interval, startTime, endTime, signal) {
    const resolution = INTERVAL[interval] ?? "1HOUR";
    const raw = await json<{ candles: RawCandle[] }>(
      "dydx",
      `/v4/candles/perpetualMarkets/${encodeURIComponent(coin)}?resolution=${resolution}&fromISO=${new Date(startTime).toISOString()}&toISO=${new Date(endTime).toISOString()}&limit=300`,
      { signal },
    );
    const bars = (raw.candles ?? [])
      .map((b) => {
        const t = Date.parse(b.startedAt);
        return {
          t,
          o: n(b.open),
          h: n(b.high),
          l: n(b.low),
          c: n(b.close),
          v: n(b.baseTokenVolume),
          n: b.trades ?? 0,
        } satisfies Candle;
      })
      .filter((b) => b.t >= startTime && b.t <= endTime)
      .sort((a, b) => a.t - b.t);
    return bars;
  },
};
