/**
 * Lighter. Same 0x as Hyperliquid. Public order books and account history by
 * L1 address → account_index.
 *
 * Lighter's `/api/v1/trades` endpoint now requires an auth token for master and
 * sub-accounts. The Explorer's public Trade logs carry the same execution facts,
 * so those are the keyless history source used here.
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import { isAddress } from "@/lib/hl";
import type { Candle, Market } from "@/lib/hl";

const EXPLORER_ORIGIN = "https://explorer.elliot.ai";
const LOG_PAGE = 100;
const FEE_SCALE = 1_000_000;

const INTERVAL: Record<string, string> = {
  "1m": "1m",
  "3m": "5m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "1h",
  "4h": "4h",
  "8h": "4h",
  "12h": "12h",
  "1d": "1d",
};

/** Lighter serves at most 500 candles per call. Our windows never ask for more. */
const COUNT_BACK = 500;

interface Book {
  symbol: string;
  market_id: number;
  market_type: string;
  status: string;
}

interface ExplorerTrade {
  trade_id?: number | string;
  trade_id_str?: number | string;
  trade_type?: number | string;
  market_index?: number | string;
  size?: number | string;
  price?: number | string;
  is_taker_ask?: boolean | number | string;
  taker_account_index?: number | string;
  maker_account_index?: number | string;
  taker_fee?: number | string;
  maker_fee?: number | string;
}

interface ExplorerLog {
  tx_type?: string;
  hash?: string;
  time?: string | number;
  pubdata_type?: string;
  pubdata?: { trade_pubdata?: ExplorerTrade };
}

function ms(t: number): number {
  if (t > 1e16) return Math.floor(t / 1000);
  if (t > 1e14) return Math.floor(t / 1000);
  if (t > 1e12) return t;
  return t * 1000;
}

function timeMs(value: unknown): number {
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return ms(n(value));
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function hashTid(value: string): number {
  let hash = 2_166_136_261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619);
  return hash >>> 0 || 1;
}

async function explorerLogs(index: number, offset: number, signal?: AbortSignal): Promise<ExplorerLog[]> {
  const q = new URLSearchParams({
    limit: String(LOG_PAGE),
    offset: String(offset),
    pub_data_type: "Trade",
  });
  const res = await fetch(`${EXPLORER_ORIGIN}/api/accounts/${index}/logs?${q}`, {
    signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`lighter explorer ${res.status}`);
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as ExplorerLog[]) : [];
}

let booksMemo: { at: number; data: Map<number, Book> } | null = null;
const BOOKS_MS = 60_000;

async function books(signal?: AbortSignal): Promise<Map<number, Book>> {
  if (booksMemo && Date.now() - booksMemo.at < BOOKS_MS) return booksMemo.data;
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
  booksMemo = { at: Date.now(), data: out };
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

function asLogLeg(log: ExplorerLog, index: number, known: Map<number, Book>): Leg | null {
  const t = log.pubdata?.trade_pubdata;
  if (!t) return null;
  const account = String(index);
  const taker = String(t.taker_account_index ?? "") === account;
  const maker = String(t.maker_account_index ?? "") === account;
  if (!taker && !maker) return null;

  const marketId = n(t.market_index);
  const book = known.get(marketId);
  if (!book || book.market_type !== "perp") return null;
  const px = n(t.price);
  const sz = n(t.size);
  const time = timeMs(log.time);
  if (px <= 0 || sz <= 0 || time <= 0) return null;

  const takerAsk = truthy(t.is_taker_ask);
  const isAsk = taker ? takerAsk : !takerAsk;
  const feeRate = n(taker ? t.taker_fee : t.maker_fee);
  const source = `${log.hash ?? ""}|${index}|${marketId}|${time}|${px}|${sz}|${isAsk}`;
  const tid = n(t.trade_id ?? t.trade_id_str) || hashTid(source);
  const txType = String(log.tx_type ?? "").toLowerCase();

  return {
    coin: book.symbol,
    px,
    sz,
    buy: !isAsk,
    time,
    // Explorer exposes the fee rate in millionths (28 = 0.0028%).
    fee: Math.abs(px * sz * feeRate) / FEE_SCALE,
    hash: log.hash ?? source,
    tid,
    liquidated: txType.includes("liquidat") || txType.includes("deleverage"),
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
    const maxPages = opts.maxPages ?? 4;
    const [indexes, known] = await Promise.all([
      accountIndex(user, opts.signal),
      books(opts.signal),
    ]);
    const legs: Leg[] = [];
    const seen = new Set<string>();
    let successfulReads = 0;
    let firstError: unknown = null;

    for (const index of indexes) {
      try {
        for (let i = 0; i < maxPages; i += 1) {
          const page = await explorerLogs(index, i * LOG_PAGE, opts.signal);
          successfulReads += 1;
          if (page.length === 0) break;
          for (const log of page) {
            const t = log.pubdata?.trade_pubdata;
            const key = `${index}|${log.hash ?? ""}|${log.time ?? ""}|${t?.market_index ?? ""}|${t?.price ?? ""}|${t?.size ?? ""}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const at = timeMs(log.time);
            if (at < startTime || at > endTime) continue;
            const leg = asLogLeg(log, index, known);
            if (leg) legs.push(leg);
          }
          opts.onPage?.(fillsFromLegs(legs, user));

          const times = page.map((log) => timeMs(log.time)).filter((at) => at > 0);
          const oldest = times.length > 0 ? Math.min(...times) : 0;
          if (oldest > 0 && oldest < startTime) break;
          if (page.length < LOG_PAGE) break;
        }
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        firstError ??= err;
      }
    }

    if (successfulReads === 0 && firstError) throw firstError;
    const fills = fillsFromLegs(legs, user);
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
    const raw = await json<unknown>(
      "lighter",
      `/api/v1/candles?market_id=${marketId}&resolution=${resolution}&start_timestamp=${startTime}&end_timestamp=${endTime}&count_back=${COUNT_BACK}`,
      { signal },
    );
    return candlesFrom(raw)
      .filter((b) => b.t >= startTime && b.t <= endTime)
      .sort((a, b) => a.t - b.t);
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

/**
 * Lighter's candle envelope is `{ code, r, c }`. `c` is the bar array — the same
 * letter as close on each bar. Reading `candles` or `candlesticks` always produced
 * [], so every Watch click said the window was outside what the API still serves.
 */
export function candlesFrom(raw: unknown): Candle[] {
  if (!raw || typeof raw !== "object") return [];
  const body = raw as { c?: unknown; candlesticks?: unknown; candles?: unknown };
  const rows = body.c ?? body.candlesticks ?? body.candles;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => bar(row as RawBar)).filter((b) => b.t > 0);
}
