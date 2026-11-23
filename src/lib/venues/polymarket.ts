/**
 * Polymarket Perps (`api.perpetuals.polymarket.com`). Every route is public,
 * CORS `*`, no signature anywhere in the spec — so it runs in the visitor's
 * browser like Hyperliquid and Lighter.
 *
 * The fill rows are the richest of any book we read:
 * - `previous_size` / `previous_entry_price` — position state before the fill,
 * - `pnl` — realized PnL BEFORE fees, the same convention as Hyperliquid's
 *   `closedPnl`,
 * - `liquidation`, `adl`, `settlement` flags per row.
 *
 * Two conventions need care:
 * - `side` is the order direction as long/short ("long" = buy), not the side
 *   of the book being held, and `previous_size` is not documented as signed,
 *   so the running size — and with it `startPosition` and `dir` — is kept
 *   locally per instrument rather than trusted from the row.
 * - fees are paid in pUSD, Polymarket's USDC-collateral unit kept 1:1, so they
 *   are reported as USDC to be counted in the same fee sum as every other book.
 *
 * Cursor pages are 100 rows. An unregistered address answers
 * `account not found`, which the wallet page already knows how to say.
 */

import { dirOf } from "@/lib/fill";
import { n, type VenueAdapter } from "@/lib/adapter";
import type { Candle, Fill, Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

const BASE = "https://api.perpetuals.polymarket.com";
const PAGE = 100;

interface RawFill {
  trade_id?: number | string;
  instrument_id?: number;
  side?: string;
  price?: string;
  quantity?: string;
  taker?: boolean;
  fee?: string;
  builder_fee?: string;
  total_fee?: string;
  fee_asset?: string;
  pnl?: string;
  liquidation?: boolean;
  adl?: boolean;
  settlement?: boolean;
  timestamp?: number;
  hash?: string;
}

interface RawInstrument {
  instrument_id?: number;
  instrument_type?: string;
  symbol?: string;
  display_symbol?: string;
  base_asset?: string;
  quote_asset?: string;
  max_leverage?: number;
  close_only?: boolean;
}

interface FillsPage {
  data?: RawFill[];
  more?: boolean;
  cursor?: string;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal, cache: "no-store" });
  if (!res.ok) {
    // A wallet that never registered perps answers 400 with the reason in the
    // body: `{"status":"err","error":"account not found"}`. The phrase is what
    // the wallet page turns into a friendly sentence, so it must survive.
    const text = await res.text().catch(() => "");
    throw new Error(`polymarket ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
  }
  const body = (await res.json()) as { status?: string; error?: string } & T;
  if (body && typeof body === "object" && body.status === "err") {
    throw new Error(`polymarket account not found: ${body.error ?? ""}`);
  }
  return body;
}

let instrMemo: { at: number; byId: Map<number, RawInstrument> } | null = null;
const INSTR_MS = 60_000;

async function instruments(signal?: AbortSignal): Promise<Map<number, RawInstrument>> {
  if (instrMemo && Date.now() - instrMemo.at < INSTR_MS) return instrMemo.byId;
  const list = await get<RawInstrument[]>("/v1/info/instruments", signal);
  const byId = new Map<number, RawInstrument>();
  for (const i of list) {
    if (i.instrument_id !== undefined) byId.set(i.instrument_id, i);
  }
  instrMemo = { at: Date.now(), byId };
  return byId;
}

export const adapter: VenueAdapter = {
  id: "polymarket",
  isAddress: (v) => kindOfAddress(v) === "evm",

  async markets(signal) {
    const list = await get<RawInstrument[]>("/v1/info/instruments", signal);
    const out = new Map<string, Market>();
    for (const i of list) {
      const coin = i.base_asset ?? i.symbol;
      if (!coin) continue;
      out.set(coin, {
        coin,
        label: i.display_symbol ?? i.symbol ?? coin,
        kind: "perp",
        maxLeverage: i.max_leverage,
      });
    }
    return out;
  },

  async fills(user, startTime, endTime, opts = {}) {
    const maxPages = opts.maxPages ?? 10;
    /** Market names, fetched once: per-row lookups must not each pay a round trip. */
    const known = await instruments(opts.signal).catch(() => null);
    const coinOf = (instrumentId: number): string =>
      known?.get(instrumentId)?.base_asset ?? `#${instrumentId}`;
    /** Running size per instrument: sign of `side` plus quantity. */
    const pos = new Map<string, number>();
    const seen = new Set<number>();
    const out: Fill[] = [];
    let cursor: string | undefined;

    /**
     * Oldest first, keyset cursor, 100 rows a page. The default window is the
     * last 30 days; a start_timestamp is honoured when sent, so the walk offers
     * the caller's window and gets whatever the account allows.
     */
    for (let i = 0; i < maxPages; i += 1) {
      const q = new URLSearchParams({
        address: user,
        sort: "asc",
        limit: String(PAGE),
        start_timestamp: String(startTime),
        end_timestamp: String(endTime),
      });
      if (cursor) q.set("cursor", cursor);
      const page = await get<FillsPage>(`/v1/info/fills?${q}`, opts.signal);
      for (const raw of page.data ?? []) {
        const tid = n(raw.trade_id);
        if (tid > 0 && seen.has(tid)) continue;
        if (tid > 0) seen.add(tid);
        const coin = coinOf(n(raw.instrument_id));
        const buy = raw.side !== "short";
        const sz = n(raw.quantity);
        const before = pos.get(coin) ?? 0;
        const after = before + (buy ? sz : -sz);
        pos.set(coin, after);
        out.push({
          coin,
          px: n(raw.price),
          sz,
          side: buy ? "B" : "A",
          time: n(raw.timestamp),
          startPosition: before,
          dir: dirOf(before, after),
          closedPnl: n(raw.pnl),
          // total_fee = exchange fee + builder fee: what the trader paid.
          fee: n(raw.total_fee ?? raw.fee),
          // pUSD is the perps collateral unit, kept 1:1 with USDC, so fees
          // count in the USDC sum like every other book's.
          feeToken: "USDC",
          crossed: !!raw.taker,
          hash: raw.hash && raw.hash !== "0x" ? raw.hash : "",
          tid,
          twapId: null,
          // This row is a forced close of the pasted wallet itself.
          liquidatedUser: raw.liquidation ? user : null,
        });
      }
      opts.onPage?.(out);
      if (!page.more || !page.cursor) break;
      cursor = page.cursor;
    }
    return out;
  },

  async candles(coin, interval, startTime, endTime, signal) {
    /**
     * Klines are keyed by instrument_id; the coin upstream is the instrument's
     * base, so the id is looked back up through the meta both ends share.
     */
    let id: number | null = null;
    try {
      for (const i of (await instruments(signal)).values()) {
        if ((i.base_asset ?? i.symbol) === coin && i.instrument_id !== undefined) {
          id = i.instrument_id;
          break;
        }
      }
    } catch {
      /* no meta: no candles either */
    }
    if (id === null) return [];
    const q = new URLSearchParams({
      instrument_id: String(id),
      interval,
      start_timestamp: String(startTime),
      end_timestamp: String(endTime),
    });
    const page = await get<{ data?: unknown[][]; more?: boolean }>(`/v1/info/klines?${q}`, signal);
    // Rows are [t, "o", "h", "l", "c", "v", n] — decimals as strings.
    return (page.data ?? [])
      .map(
        (row) =>
          ({
            t: n(row[0]),
            o: n(row[1]),
            h: n(row[2]),
            l: n(row[3]),
            c: n(row[4]),
            v: n(row[5]),
            n: n(row[6]) || 1,
          }) satisfies Candle,
      )
      .filter((b) => b.t > 0)
      .sort((a, b) => a.t - b.t);
  },
};
