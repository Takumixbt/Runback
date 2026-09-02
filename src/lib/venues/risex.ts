/**
 * RISEx. Onchain CLOB on RISE Chain. Same 0x as Hyperliquid.
 *
 * Account trade history is a public GET (`/v1/trade-history?account=`). Candles
 * are `/v1/trading-view-data` with interval in nanoseconds. No CORS, so the
 * browser falls through the proxy. The fills websocket is signed; this path is not.
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import { isAddress } from "@/lib/hl";
import type { Candle, Market } from "@/lib/hl";

const INTERVAL_NS: Record<string, string> = {
  "1m": "60000000000",
  "3m": "300000000000",
  "5m": "300000000000",
  "15m": "900000000000",
  "30m": "900000000000",
  "1h": "3600000000000",
  "2h": "3600000000000",
  "4h": "3600000000000",
  "8h": "3600000000000",
  "12h": "3600000000000",
  "1d": "86400000000000",
};

interface RiseMarket {
  market_id: string | number;
  display_name?: string;
  base_asset_symbol?: string;
  underlying?: string;
}

interface RiseFill {
  fill_id?: string;
  order_id?: string;
  market_id?: string | number;
  side?: string | number;
  size?: string | number;
  price?: string | number;
  fee?: string | number;
  timestamp?: string | number;
  time?: string | number;
  realized_pnl?: string | number;
  realised_pnl?: string | number;
  pnl?: string | number;
  tx_hash?: string;
  is_liquidation?: boolean;
  type?: string;
}

function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === "object" && "data" in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

function nsToMs(v: unknown): number {
  const s = String(v ?? "");
  if (!s) return 0;
  try {
    const ns = BigInt(s);
    if (ns > 1_000_000_000_000_000n) return Number(ns / 1_000_000n);
    if (ns > 1_000_000_000_000n) return Number(ns);
    return Number(ns) * 1000;
  } catch {
    const x = n(v);
    if (x > 1e14) return Math.floor(x / 1e6);
    if (x > 1e12) return x;
    return x * 1000;
  }
}

function msToNs(ms: number): string {
  return (BigInt(Math.floor(ms)) * 1_000_000n).toString();
}

function coinOf(m: RiseMarket): string {
  const name = m.display_name ?? m.base_asset_symbol ?? m.underlying ?? String(m.market_id);
  return name.replace(/\/USDC$/i, "").replace(/-USD$/i, "").replace(/\/USD$/i, "");
}

function isBuy(side: string | number | undefined): boolean {
  if (typeof side === "string") {
    const s = side.toUpperCase();
    return s === "BUY" || s === "BID" || s === "B" || s === "0";
  }
  return side === 0;
}

async function books(signal?: AbortSignal): Promise<Map<string, RiseMarket>> {
  const raw = await json<unknown>("risex", "/v1/markets", { signal });
  const body = unwrap<{ markets?: RiseMarket[] }>(raw);
  const out = new Map<string, RiseMarket>();
  for (const m of body.markets ?? []) {
    out.set(String(m.market_id), m);
  }
  return out;
}

export const adapter: VenueAdapter = {
  id: "risex",
  isAddress,
  async markets(signal) {
    const all = await books(signal);
    const out = new Map<string, Market>();
    for (const m of all.values()) {
      const coin = coinOf(m);
      out.set(coin, { coin, label: coin, kind: "perp" });
      out.set(String(m.market_id), { coin, label: coin, kind: "perp" });
    }
    return out;
  },
  async fills(user, startTime, endTime, opts = {}) {
    const maxPages = opts.maxPages ?? 4;
    const known = await books(opts.signal);
    const legs: Leg[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const q = new URLSearchParams({
        account: user,
        limit: "200",
        page: String(page),
        sorted_by: "-time",
      });
      const raw = await json<unknown>("risex", `/v1/trade-history?${q}`, {
        signal: opts.signal,
      });
      const body = unwrap<{
        trades?: RiseFill[];
        fills?: RiseFill[];
        has_next_page?: boolean;
      }>(raw);
      const pageRows = body.trades ?? body.fills ?? [];
      if (pageRows.length === 0) break;
      for (const t of pageRows) {
        const time = nsToMs(t.timestamp ?? t.time);
        if (time < startTime || time > endTime) continue;
        const px = n(t.price);
        const sz = n(t.size);
        if (px <= 0 || sz <= 0) continue;
        const book = known.get(String(t.market_id ?? ""));
        const coin = book ? coinOf(book) : String(t.market_id ?? "mkt");
        const kind = `${t.type ?? ""}`.toLowerCase();
        legs.push({
          coin,
          px,
          sz,
          buy: isBuy(t.side),
          time,
          fee: Math.abs(n(t.fee)),
          hash: t.tx_hash ?? t.order_id ?? t.fill_id ?? `${coin}-${time}`,
          tid: n(t.fill_id) || time,
          liquidated: t.is_liquidation === true || kind.includes("liquid"),
          closedPnl: t.realized_pnl !== undefined || t.realised_pnl !== undefined || t.pnl !== undefined
            ? n(t.realized_pnl ?? t.realised_pnl ?? t.pnl)
            : undefined,
        });
      }
      opts.onPage?.(fillsFromLegs(legs, user));
      if (!body.has_next_page) break;
    }
    return fillsFromLegs(legs, user);
  },
  async candles(coin, interval, startTime, endTime, signal) {
    const known = await books(signal);
    let marketId: string | undefined;
    for (const m of known.values()) {
      if (coinOf(m) === coin || String(m.market_id) === coin) {
        marketId = String(m.market_id);
        break;
      }
    }
    if (!marketId) return [];
    const ns = INTERVAL_NS[interval] ?? INTERVAL_NS["1h"]!;
    const raw = await json<unknown>(
      "risex",
      `/v1/trading-view-data?market_id=${marketId}&interval=${ns}&from=${msToNs(startTime)}&to=${msToNs(endTime)}`,
      { signal },
    );
    const body = unwrap<{ data?: RawBar[] } | RawBar[]>(raw);
    const bars = Array.isArray(body) ? body : (body.data ?? []);
    return bars
      .map((b) => {
        const t = nsToMs(b.time ?? b.t);
        return {
          t,
          o: n(b.open ?? b.o),
          h: n(b.high ?? b.h),
          l: n(b.low ?? b.l),
          c: n(b.close ?? b.c),
          v: n(b.volume ?? b.v),
          n: n(b.n),
        } satisfies Candle;
      })
      .filter((b) => b.t > 0)
      .sort((a, b) => a.t - b.t);
  },
};

interface RawBar {
  time?: string | number;
  t?: string | number;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
  volume?: string | number;
  o?: string | number;
  h?: string | number;
  l?: string | number;
  c?: string | number;
  v?: string | number;
  n?: number;
}
