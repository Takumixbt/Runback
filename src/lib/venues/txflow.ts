/**
 * TxFlow (chain 869): spot, perpetuals and outcome markets as modules on one
 * L1, read through an unauthenticated `POST /info` that mirrors Hyperliquid's
 * own request and field names. `userFills` arrives with `startPosition`, `dir`
 * and venue-computed `closedPnl` — the same three fields only Hyperliquid used
 * to hand us — so the fold gets the cross-checked arithmetic for free.
 *
 * CORS is `*`, so every call runs in the visitor's browser and spends their own
 * rate limit, exactly like Hyperliquid.
 *
 * Differences worth naming:
 * - responses are wrapped `{success, code, data}` and history pages are
 *   `{data, hasMore}` rather than bare arrays,
 * - history is `offset`/`limit` paged (newest first, 2,000 rows a page) instead
 *   of a time cursor,
 * - market metadata is `perpMeta`, and a fill's `coin` is the base ("BTC")
 *   while candles want the instrument name ("BTC-USDC") or numeric id, so the
 *   name is looked up through a cached meta map,
 * - `dir` is only "Buy"/"Sell", so the positional form is derived from
 *   `startPosition` — the number the API already guarantees.
 */

import { dirOf } from "@/lib/fill";
import { n, type VenueAdapter } from "@/lib/adapter";
import type { Candle, Fill, Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

const INFO = "https://rpc.txflow.com/info";
/** Every sample in their docs sends this; the API is versioned by header. */
const API_VERSION = "2026-08-16";

const PAGE = 2_000;

interface RawFill {
  coin?: string;
  symbol?: string;
  px?: string;
  sz?: string;
  side?: string;
  time?: number;
  startPosition?: string;
  dir?: string;
  closedPnl?: string;
  fee?: string;
  feeToken?: string;
  crossed?: boolean | null;
  tradeSide?: string;
  hash?: string;
  oid?: number;
  tid?: number;
  twapId?: number | null;
  instrumentId?: number;
  instrumentType?: string;
}

interface Paged<T> {
  data?: T[];
  hasMore?: boolean;
}

interface PerpInstrument {
  name?: string;
  baseCurrency?: string;
  maxLeverage?: number;
  delisted?: boolean;
}

async function info<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-version": API_VERSION },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`txflow ${res.status}`);
  const wrap = (await res.json()) as { success?: boolean; message?: string; data?: T };
  if (wrap.success === false) {
    throw new Error(`txflow ${wrap.message ?? "unavailable"}`);
  }
  return wrap.data as T;
}

/** base ("BTC") ↔ instrument name ("BTC-USDC"), from the meta the server keys candles by. */
let nameMemo: { at: number; byBase: Map<string, string> } | null = null;
const META_MS = 60_000;

async function names(signal?: AbortSignal): Promise<Map<string, string>> {
  if (nameMemo && Date.now() - nameMemo.at < META_MS) return nameMemo.byBase;
  const meta = await info<{ universe?: PerpInstrument[] }>(
    { type: "perpMeta", includeDelisted: false },
    signal,
  );
  const byBase = new Map<string, string>();
  for (const u of meta.universe ?? []) {
    if (u.baseCurrency && u.name) byBase.set(u.baseCurrency, u.name);
  }
  nameMemo = { at: Date.now(), byBase };
  return byBase;
}

const parseFill = (f: RawFill): Fill => {
  const before = n(f.startPosition);
  const sz = n(f.sz);
  const buy = f.side !== "A";
  const after = before + (buy ? sz : -sz);
  return {
    coin: f.coin ?? f.symbol ?? "",
    px: n(f.px),
    sz,
    side: f.side === "A" ? "A" : "B",
    time: n(f.time),
    startPosition: before,
    dir: dirOf(before, after),
    closedPnl: n(f.closedPnl),
    fee: n(f.fee),
    feeToken: f.feeToken ?? "USDC",
    crossed: f.tradeSide === "Taker" || !!f.crossed,
    hash: f.hash ?? "",
    tid: n(f.tid),
    twapId: f.twapId ?? null,
    // Their fills carry no liquidation marker, so a forced close reads as an
    // ordinary reduce. The dir and PnL still tell the story.
    liquidatedUser: null,
  };
};

export const adapter: VenueAdapter = {
  id: "txflow",
  isAddress: (v) => kindOfAddress(v) === "evm",

  async markets(signal) {
    const meta = await info<{ universe?: PerpInstrument[] }>(
      { type: "perpMeta", includeDelisted: false },
      signal,
    );
    const out = new Map<string, Market>();
    const byBase = new Map<string, string>();
    for (const u of meta.universe ?? []) {
      const base = u.baseCurrency ?? u.name;
      if (!base || u.delisted) continue;
      if (u.name) byBase.set(base, u.name);
      out.set(base, {
        coin: base,
        label: base,
        kind: "perp",
        maxLeverage: u.maxLeverage,
      });
    }
    nameMemo = { at: Date.now(), byBase };
    return out;
  },

  async fills(user, startTime, endTime, opts = {}) {
    const maxPages = opts.maxPages ?? 10;
    const seen = new Set<number>();
    const out: Fill[] = [];
    /**
     * Offset paging, newest first. The window filters server-side, so the walk
     * is: one page of 2,000, then keep stepping while `hasMore` and the caller
     * still allows pages. A quiet wallet is one request. The offset advances by
     * what the server returned, not by what survived dedupe — otherwise a
     * repeated tid would pin the walk on the same page.
     */
    let fetched = 0;
    for (let i = 0; i < maxPages; i += 1) {
      const page = await info<Paged<RawFill>>(
        {
          type: "userFills",
          user,
          startTimeMs: startTime,
          endTimeMs: endTime,
          limit: PAGE,
          offset: fetched,
        },
        opts.signal,
      );
      const rows = page.data ?? [];
      fetched += rows.length;
      for (const raw of rows) {
        const f = parseFill(raw);
        if (f.time < startTime || f.time > endTime || seen.has(f.tid)) continue;
        seen.add(f.tid);
        out.push(f);
      }
      out.sort((a, b) => a.time - b.time || a.tid - b.tid);
      opts.onPage?.(out);
      if (!page.hasMore || rows.length === 0) break;
    }
    return out;
  },

  async candles(coin, interval, startTime, endTime, signal) {
    /**
     * Candles want the instrument name or numeric id, and everything upstream
     * of here speaks the fill's base. A meta miss still sends the base: the
     * server takes names it knows and answers `[]` for the rest, which the
     * replay already treats as "cannot draw".
     */
    let name = coin;
    try {
      name = (await names(signal)).get(coin) ?? coin;
    } catch {
      /* fall back to the base as given */
    }
    const raw = await info<{ t?: number; T?: number; o?: string; h?: string; l?: string; c?: string; v?: string; n?: number }[]>(
      {
        type: "candleSnapshot",
        req: { coin: name, interval, startTime, endTime },
      },
      signal,
    );
    return raw
      .map(
        (b) =>
          ({
            t: n(b.t),
            o: n(b.o),
            h: n(b.h),
            l: n(b.l),
            c: n(b.c),
            v: n(b.v),
            n: n(b.n),
          }) satisfies Candle,
      )
      .filter((b) => b.t > 0)
      .sort((a, b) => a.t - b.t);
  },
};
