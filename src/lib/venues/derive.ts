/**
 * Derive (formerly Lyra): a public JSON-RPC surface where every read is a
 * `POST /v3/public/{method}` with no authentication — subaccounts, trade
 * history, instruments and chart data are all open.
 *
 * The host answers `vary: origin` with credentials but no
 * `access-control-allow-origin`, so a direct browser call never succeeds: every
 * call goes through the same-origin `/api/x/derive` proxy, whose POST path
 * carries the JSON-RPC body. That shares one server IP across visitors, so a
 * 429 here is a shared budget problem, and the call waits it out like the rest
 * of the app instead of surfacing a red banner on the first throttle.
 *
 * Wallets own subaccounts, and positions live per subaccount — the same shape
 * Drift's authority accounts have. All of a wallet's subaccounts are walked and
 * merged into one tape, and the running size behind `startPosition`/`dir` is
 * kept per (subaccount, instrument); the fold itself stays per coin, which a
 * wallet splitting one instrument across two subaccounts would disagree with.
 * Traders overwhelmingly use one subaccount, and the alternative — dropping
 * subaccounts — is the bug Drift already taught us not to ship.
 *
 * Chart data is the one place Derive speaks seconds, not milliseconds; the
 * trade history that matters here is in ms.
 */

import { dirOf } from "@/lib/fill";
import { ORIGIN, wait } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import type { Candle, Fill, Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

const PAGE = 1_000;
/** 1m/5m/15m/1h/4h/1d in the seconds Derive's chart endpoint wants. */
const PERIOD: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "8h": 28800,
  "12h": 43200,
  "1d": 86400,
};

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string; data?: unknown };
}

interface RawTrade {
  trade_id?: string;
  instrument_name?: string;
  timestamp?: number;
  direction?: string;
  trade_price?: string;
  trade_amount?: string;
  trade_fee?: string;
  expected_rebate?: string;
  realized_pnl_excl_fees?: string;
  liquidity_role?: string;
  tx_hash?: string;
}

interface RawInstrument {
  instrument_type?: string;
  instrument_name?: string;
  base_currency?: string;
  is_active?: boolean;
  perp_details?: { srm_perp_margin_requirements?: { max_leverage?: string } };
}

interface RawBar {
  open_price?: string;
  high_price?: string;
  low_price?: string;
  close_price?: string;
  volume_contracts?: string;
  /** Seconds on this endpoint, not milliseconds. */
  timestamp?: number;
}

function hashTid(value: string): number {
  // Derive's trade ids are UUIDs; the tape wants a stable number.
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16_777_619);
  }
  return hash >>> 0 || 1;
}

async function rpc<T>(
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const path = `/v3/public/${method}`;
  const url =
    typeof window === "undefined"
      ? `${ORIGIN.derive}${path}`
      : `/api/x/derive?u=${encodeURIComponent(path)}`;
  const body = JSON.stringify(params);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal,
      cache: "no-store",
    });
    if (res.status === 429 && attempt < 2) {
      const header = Number(res.headers.get("retry-after") ?? 0);
      const pause = header > 0 ? Math.min(header * 1000, 5_000) : 400 * 2 ** attempt;
      try {
        await res.body?.cancel();
      } catch {
        /* already consumed */
      }
      await wait(pause, signal);
      continue;
    }
    if (!res.ok) throw new Error(`derive ${res.status}`);
    const reply = (await res.json()) as RpcResponse<T>;
    if (reply.error) throw new Error(`derive ${reply.error.message ?? "rpc error"}`);
    return reply.result as T;
  }
  throw new Error("derive 429");
}

export const adapter: VenueAdapter = {
  id: "derive",
  isAddress: (v) => kindOfAddress(v) === "evm",

  async markets(signal) {
    // Both fields are required by the request schema; unfiltered, this
    // endpoint also answers every option strike and expiry there has ever been.
    const res = await rpc<{ instruments?: RawInstrument[] }>(
      "get_all_instruments",
      { instrument_type: "perp", expired: false },
      signal,
    );
    const out = new Map<string, Market>();
    for (const i of res.instruments ?? []) {
      if (i.instrument_type !== "perp" || !i.instrument_name || i.is_active === false) continue;
      out.set(i.instrument_name, {
        coin: i.instrument_name,
        label: i.base_currency ?? i.instrument_name.replace(/-PERP$/, ""),
        kind: "perp",
        maxLeverage: n(i.perp_details?.srm_perp_margin_requirements?.max_leverage) || undefined,
      });
    }
    return out;
  },

  async fills(user, startTime, endTime, opts = {}) {
    /**
     * `maxPages` is a per-subaccount budget, the same meaning it has in the
     * Drift adapter. A wallet can own many subaccounts and only one of them
     * may be active; a single global page cap would spend itself on the first
     * subaccount and never look at the rest. A hard call ceiling keeps a
     * wallet with dozens of subaccounts from turning one paste into a crawl.
     */
    const perSub = Math.max(1, opts.maxPages ?? 5);
    const subs =
      (await rpc<{ subaccount_ids?: number[] }>("get_subaccounts", { wallet: user }, opts.signal))
        ?.subaccount_ids ?? [];
    // No subaccounts: the wallet has never been on Derive. An empty tape, not
    // an error — the catalogue says "no positions" and that is the truth.
    if (subs.length === 0) return [];

    const seen = new Set<number>();
    const out: Fill[] = [];
    /** Position state is per subaccount; coins alone would blend two books. */
    const pos = new Map<string, number>();
    let calls = 0;
    const CALL_CAP = 40;

    outer: for (const sub of subs) {
      /**
       * Page 1 answers `num_pages`, which is exact for the window, so the walk
       * steps page numbers instead of chasing cursors. An inactive subaccount
       * answers one empty page and costs one call.
       */
      let numPages = 1;
      for (let page = 1; page <= Math.min(perSub, numPages); page += 1) {
        if (calls >= CALL_CAP) break outer;
        calls += 1;
        const res = await rpc<{ trades?: RawTrade[]; pagination?: { num_pages?: number } }>(
          "get_trade_history",
          {
            subaccount_id: sub,
            from_timestamp: startTime,
            to_timestamp: endTime,
            page,
            page_size: PAGE,
          },
          opts.signal,
        );
        numPages = Math.max(1, n(res.pagination?.num_pages));
        for (const t of res.trades ?? []) {
          const tid = hashTid(t.trade_id ?? "");
          if (seen.has(tid)) continue;
          seen.add(tid);
          const coin = t.instrument_name ?? "";
          const buy = t.direction === "buy";
          const sz = n(t.trade_amount);
          const key = `${sub}:${coin}`;
          const before = pos.get(key) ?? 0;
          const after = before + (buy ? sz : -sz);
          pos.set(key, after);
          out.push({
            coin,
            px: n(t.trade_price),
            sz,
            side: buy ? "B" : "A",
            time: n(t.timestamp),
            startPosition: before,
            dir: dirOf(before, after),
            // Pre-fee realized PnL, the convention Hyperliquid's closedPnl
            // set. Fees are reported separately, so the two never double-count.
            closedPnl: n(t.realized_pnl_excl_fees),
            // A maker's rebate is credited against the fee it rebates.
            fee: Math.max(0, n(t.trade_fee) - n(t.expected_rebate)),
            feeToken: "USDC",
            crossed: t.liquidity_role === "taker",
            // Empty while a batch is still settling; the trade_id still pins
            // the row to its tape entry.
            hash: t.tx_hash ?? "",
            tid,
            twapId: null,
            // Their public trade rows carry no liquidation marker.
            liquidatedUser: null,
          });
        }
        // Trade pages answer newest first; the fold wants oldest first, and
        // every intermediate render should see the same order as the last.
        out.sort((a, b) => a.time - b.time || a.tid - b.tid);
        opts.onPage?.(out);
      }
    }
    return out;
  },

  async candles(coin, interval, startTime, endTime, signal) {
    const period = PERIOD[interval] ?? 3600;
    const bars = await rpc<RawBar[]>(
      "get_tradingview_chart_data",
      {
        instrument_name: coin,
        period,
        start_timestamp: Math.floor(startTime / 1000),
        end_timestamp: Math.floor(endTime / 1000),
      },
      signal,
    );
    return bars
      .map(
        (b) =>
          ({
            t: n(b.timestamp) * 1000,
            o: n(b.open_price),
            h: n(b.high_price),
            l: n(b.low_price),
            c: n(b.close_price),
            v: n(b.volume_contracts),
            n: 1,
          }) satisfies Candle,
      )
      .filter((b) => b.t > 0)
      .sort((a, b) => a.t - b.t);
  },
};
