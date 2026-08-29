/**
 * Lighter. Same 0x as Hyperliquid. Public order books and (when the API allows)
 * account trades by L1 address → account_index.
 *
 * Trades carry taker/maker position-before and per-side realised PnL. The docs
 * say auth is required for master/sub accounts; we still try the public read,
 * because that is the product, and surface a clear error if Lighter refuses.
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import { isAddress } from "@/lib/hl";
import type { Candle, Market } from "@/lib/hl";

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

interface Book {
  symbol: string;
  market_id: number;
  market_type: string;
  status: string;
}

interface Trade {
  trade_id: number;
  tx_hash: string;
  type: string;
  market_id: number;
  size: string;
  price: string;
  timestamp: number;
  transaction_time?: number;
  ask_account_id: number;
  bid_account_id: number;
  is_maker_ask: boolean;
  taker_position_size_before: string;
  maker_position_size_before: string;
  ask_account_pnl: string;
  bid_account_pnl: string;
  taker_fee?: number;
  maker_fee?: number;
}

function ms(t: number): number {
  if (t > 1e16) return Math.floor(t / 1000);
  if (t > 1e14) return Math.floor(t / 1000);
  if (t > 1e12) return t;
  return t * 1000;
}

async function books(signal?: AbortSignal): Promise<Map<number, Book>> {
  const raw = await json<{ order_books: Book[] }>(
    "lighter",
    "/api/v1/orderBooks?filter=perp",
    { signal },
  );
  const out = new Map<number, Book>();
  for (const b of raw.order_books ?? []) {
    if (b.status && b.status !== "active") continue;
    out.set(b.market_id, b);
  }
  return out;
}

function indexOf(a: { index?: number; account_index?: number; accountIndex?: number }): number {
  return n(a.index ?? a.account_index ?? a.accountIndex);
}

async function accountIndex(user: string, signal?: AbortSignal): Promise<number[]> {
  const raw = await json<{
    sub_accounts?: { index?: number; account_index?: number; accountIndex?: number }[];
    accounts?: { index?: number; account_index?: number; accountIndex?: number }[];
  }>("lighter", `/api/v1/accountsByL1Address?l1_address=${user}`, { signal });
  const list = raw.sub_accounts ?? raw.accounts ?? [];
  const idx = list.map(indexOf).filter((i) => Number.isFinite(i) && i >= 0);
  if (idx.length === 0) throw new Error("lighter: no account for that address");
  return idx;
}

function asLeg(t: Trade, index: number, coin: string): Leg | null {
  const isAsk = t.ask_account_id === index;
  const isBid = t.bid_account_id === index;
  if (!isAsk && !isBid) return null;
  const weMaker = isAsk ? t.is_maker_ask : !t.is_maker_ask;
  const px = n(t.price);
  const sz = n(t.size);
  if (px <= 0 || sz <= 0) return null;
  const pnl = n(isAsk ? t.ask_account_pnl : t.bid_account_pnl);
  const fee = n(weMaker ? t.maker_fee : t.taker_fee);
  return {
    coin,
    px,
    sz,
    buy: isBid,
    time: ms(t.transaction_time ?? t.timestamp),
    fee: Math.abs(fee),
    hash: t.tx_hash ?? String(t.trade_id),
    tid: t.trade_id,
    liquidated: t.type === "liquidation" || t.type === "deleverage",
    closedPnl: pnl,
  };
}

export const adapter: VenueAdapter = {
  id: "lighter",
  isAddress,
  async markets(signal) {
    const all = await books(signal);
    const out = new Map<string, Market>();
    for (const b of all.values()) {
      out.set(b.symbol, { coin: b.symbol, label: b.symbol, kind: "perp" });
      out.set(String(b.market_id), { coin: b.symbol, label: b.symbol, kind: "perp" });
    }
    return out;
  },
  async fills(user, startTime, endTime, opts = {}) {
    const maxPages = opts.maxPages ?? 40;
    const indexes = await accountIndex(user, opts.signal);
    const known = await books(opts.signal);
    const legs: Leg[] = [];

    for (const index of indexes) {
      let cursor: string | undefined;
      for (let i = 0; i < maxPages; i += 1) {
        const q = new URLSearchParams({
          account_index: String(index),
          sort_by: "timestamp",
          sort_dir: "desc",
          limit: "100",
          market_type: "perp",
          type: "all",
        });
        if (cursor) q.set("cursor", cursor);
        const raw = await json<{ trades?: Trade[]; next_cursor?: string; cursor?: string }>(
          "lighter",
          `/api/v1/trades?${q}`,
          { signal: opts.signal },
        );
        const page = raw.trades ?? [];
        if (page.length === 0) break;
        for (const t of page) {
          const at = ms(t.transaction_time ?? t.timestamp);
          if (at < startTime) continue;
          if (at > endTime) continue;
          const book = known.get(t.market_id);
          const coin = book?.symbol ?? String(t.market_id);
          const leg = asLeg(t, index, coin);
          if (leg) legs.push(leg);
        }
        const oldest = ms(page[page.length - 1]!.transaction_time ?? page[page.length - 1]!.timestamp);
        if (oldest < startTime) break;
        cursor = raw.next_cursor ?? raw.cursor;
        if (!cursor || page.length < 100) break;
      }
    }

    const fills = fillsFromLegs(legs, user);
    opts.onPage?.(fills);
    return fills;
  },
  async candles(coin, interval, startTime, endTime, signal) {
    const known = await books(signal);
    let marketId: number | undefined;
    for (const b of known.values()) {
      if (b.symbol === coin || String(b.market_id) === coin) {
        marketId = b.market_id;
        break;
      }
    }
    if (marketId === undefined) return [];
    const resolution = INTERVAL[interval] ?? "1h";
    const raw = await json<{ candlesticks?: RawBar[]; candles?: RawBar[] }>(
      "lighter",
      `/api/v1/candles?market_id=${marketId}&resolution=${resolution}&start_timestamp=${startTime}&end_timestamp=${endTime}&count_back=500`,
      { signal },
    );
    const bars = raw.candlesticks ?? raw.candles ?? [];
    return bars.map(bar);
  },
};

interface RawBar {
  t: number;
  o: number | string;
  h: number | string;
  l: number | string;
  c: number | string;
  v?: number | string;
  n?: number;
}

function bar(b: RawBar): Candle {
  const t = ms(b.t);
  return { t, o: n(b.o), h: n(b.h), l: n(b.l), c: n(b.c), v: n(b.v), n: b.n ?? 0 };
}
