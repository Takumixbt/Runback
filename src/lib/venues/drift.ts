/**
 * Drift (Velocity on Solana). Public user trades and market candles.
 *
 * The host has moved: Velocity's data API, the older data.api.drift.trade, then
 * the history server. We try them in that order. Amounts on the protocol are
 * 1e9 base / 1e6 quote unless the record is already decimal.
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json, DRIFT_ORIGINS } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import type { Candle, Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

const INTERVAL: Record<string, string> = {
  "1m": "1",
  "3m": "5",
  "5m": "5",
  "15m": "15",
  "30m": "15",
  "1h": "60",
  "2h": "60",
  "4h": "240",
  "8h": "240",
  "12h": "240",
  "1d": "D",
};

interface DriftTrade {
  ts?: number | string;
  timestamp?: number | string;
  txSig?: string;
  txSigIndex?: number;
  marketIndex?: number;
  marketSymbol?: string;
  symbol?: string;
  baseAssetAmountFilled?: string | number;
  quoteAssetAmountFilled?: string | number;
  oraclePrice?: string | number;
  price?: string | number;
  takerFee?: string | number;
  makerFee?: string | number;
  taker?: string;
  maker?: string;
  action?: string;
  actionExplanation?: string;
}

function asMs(v: unknown): number {
  const x = n(v);
  if (x > 1e12) return x;
  return x * 1000;
}

function baseAmt(v: unknown): number {
  const x = Math.abs(n(v));
  if (x >= 1e6) return x / 1e9;
  return x;
}

function quoteAmt(v: unknown): number {
  const x = Math.abs(n(v));
  if (x >= 1e3 && x === Math.floor(x)) return x / 1e6;
  return x;
}

/** Whichever side of the trade this account was actually on. */
function feeFor(t: DriftTrade, account: string): number {
  if (t.taker === account) return Math.abs(n(t.takerFee)) / 1e6;
  if (t.maker === account) return Math.abs(n(t.makerFee)) / 1e6;
  // Neither field names us: no basis for attributing either fee.
  return 0;
}

async function first<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (typeof window !== "undefined") {
    return json<T>("drift", path, { signal });
  }
  let last: Error | null = null;
  for (const origin of DRIFT_ORIGINS) {
    try {
      return await json<T>("drift", path, { signal, origin });
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw last ?? new Error("drift unreachable");
}

function records<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const o = raw as { records?: T[]; data?: T[]; trades?: T[] };
    return o.records ?? o.data ?? o.trades ?? [];
  }
  return [];
}

export const adapter: VenueAdapter = {
  id: "drift",
  isAddress: (v) => kindOfAddress(v) === "solana",
  async markets(signal) {
    const raw = await first<unknown>("/markets", signal);
    const list = records<{ marketIndex?: number; symbol?: string; marketName?: string }>(raw);
    const out = new Map<string, Market>();
    for (const m of list) {
      const symbol = m.symbol ?? m.marketName ?? (m.marketIndex !== undefined ? `M${m.marketIndex}` : "");
      if (!symbol) continue;
      const label = symbol.replace(/-PERP$/i, "");
      out.set(symbol, { coin: symbol, label, kind: "perp" });
    }
    if (out.size === 0) {
      for (const s of ["SOL-PERP", "BTC-PERP", "ETH-PERP"]) {
        out.set(s, { coin: s, label: s.replace("-PERP", ""), kind: "perp" });
      }
    }
    return out;
  },
  async fills(user, startTime, endTime, opts = {}) {
    const maxPages = opts.maxPages ?? 20;
    const legs: Leg[] = [];
    let page: string | undefined;
    /**
     * A pasted Solana key can be either the authority that owns sub-accounts or a
     * user account itself, and it is routinely both: the authority trades from its
     * own account as well. Replacing the pasted key with the sub-accounts it owns
     * silently dropped every trade booked on the key that was actually typed in.
     */
    let accounts = [user];
    try {
      const auth = await first<unknown>(`/authority/${user}/accounts`, opts.signal);
      const found = records<{ pubkey?: string; publicKey?: string; user?: string }>(auth)
        .map((a) => a.pubkey ?? a.publicKey ?? a.user)
        .filter((x): x is string => !!x);
      if (found.length) accounts = [...new Set([...found, user])];
    } catch {
      // Authority lookup is optional; the pasted key may already be a user account.
    }

    for (const account of accounts) {
      page = undefined;
      try {
        for (let i = 0; i < maxPages; i += 1) {
          const q: string = page ? `?page=${encodeURIComponent(page)}` : "";
          const raw = await first<{ records?: DriftTrade[]; meta?: { nextPage?: string } }>(
            `/user/${account}/trades${q}`,
            opts.signal,
          );
          const rows = records<DriftTrade>(raw);
          if (rows.length === 0) break;
          let oldest = Infinity;
          for (const t of rows) {
            const time = asMs(t.ts ?? t.timestamp);
            if (time > 0) oldest = Math.min(oldest, time);
            if (time < startTime || time > endTime) continue;
            const base = baseAmt(t.baseAssetAmountFilled);
            const quote = quoteAmt(t.quoteAssetAmountFilled);
            const px = n(t.price) || n(t.oraclePrice) || (base > 0 ? quote / base : 0);
            if (px <= 0 || base <= 0) continue;
            const signed = n(t.baseAssetAmountFilled);
            const buy = signed >= 0;
            const coin = t.marketSymbol ?? t.symbol ?? `M${t.marketIndex ?? 0}`;
            const expl = `${t.action ?? ""} ${t.actionExplanation ?? ""}`.toLowerCase();
            legs.push({
              coin,
              px,
              sz: Math.abs(base),
              buy,
              time,
              /**
               * A trade record carries BOTH sides' fees, and this wallet only paid
               * one of them. Summing them billed the counterparty's fee to whoever
               * was being looked up, which understates every net figure on the page.
               */
              fee: feeFor(t, account),
              hash: t.txSig ?? `${account}-${time}`,
              tid: t.txSigIndex ?? time,
              liquidated: expl.includes("liquid"),
            });
          }
          opts.onPage?.(fillsFromLegs(legs, user));
          page = raw.meta?.nextPage;
          if (!page) break;
          // Newest first, so a page entirely older than the window ends the walk.
          if (oldest < startTime) break;
        }
      } catch (err) {
        /**
         * An authority's account list can name accounts this host has no history
         * for, and one 404 must not sink the accounts that did answer. With a
         * single account there is nothing to salvage, so the error IS the answer
         * and the page should say so.
         */
        if (accounts.length === 1) throw err;
      }
    }
    return fillsFromLegs(legs, user);
  },
  async candles(coin, interval, startTime, endTime, signal) {
    const res = INTERVAL[interval] ?? "60";
    const startTs = Math.floor(startTime / 1000);
    const endTs = Math.floor(endTime / 1000);
    const raw = await first<unknown>(
      `/market/${encodeURIComponent(coin)}/candles/${res}?startTs=${startTs}&endTs=${endTs}&limit=1000`,
      signal,
    );
    return records<RawCandle>(raw)
      .map((b) => {
        const t = asMs(b.ts ?? b.t ?? b.startTime);
        return {
          t,
          o: n(b.open ?? b.o),
          h: n(b.high ?? b.h),
          l: n(b.low ?? b.l),
          c: n(b.close ?? b.c),
          v: n(b.volume ?? b.v),
          n: n(b.trades ?? b.n),
        } satisfies Candle;
      })
      // The host does not always honour startTs/endTs. Bars outside the window
      // lengthen the replay and slide every fill marker off its bar.
      .filter((b) => b.t > 0 && b.t >= startTime && b.t <= endTime)
      .sort((a, b) => a.t - b.t);
  },
};

interface RawCandle {
  ts?: number;
  t?: number;
  startTime?: number;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
  o?: number | string;
  h?: number | string;
  l?: number | string;
  c?: number | string;
  v?: number | string;
  trades?: number;
  n?: number;
}
