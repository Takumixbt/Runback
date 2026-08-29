/**
 * Jupiter Perps. Pool/oracle, not a CLOB. Public `/v1/trades?walletAddress=`.
 *
 * There is no Jupiter candle endpoint that matches Hyperliquid's snapshot, so
 * the replay borrows Hyperliquid's book for SOL/BTC/ETH. The fills are Jupiter's;
 * the tape is the liquid one. Wrong to pretend otherwise, and worse to ship a
 * clip with no bars.
 */

import { fillsFromLegs, type Leg } from "@/lib/fill";
import { json } from "@/lib/http";
import { n, type VenueAdapter } from "@/lib/adapter";
import { candles as hlCandles, type Market } from "@/lib/hl";
import { kindOfAddress } from "@/lib/venue";

const MINT: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": "ETH",
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": "BTC",
};

interface JupTrade {
  action: string;
  createdTime: number;
  fee?: string;
  mint: string;
  owner?: string;
  pnl?: string;
  positionName?: string;
  price: string;
  side: string;
  size: string;
  txHash?: string;
}

function coinOf(t: JupTrade): string {
  if (t.positionName) return t.positionName.replace(/-PERP$/i, "");
  return MINT[t.mint] ?? t.mint.slice(0, 6);
}

export const adapter: VenueAdapter = {
  id: "jupiter",
  isAddress: (v) => kindOfAddress(v) === "solana",
  async markets() {
    const out = new Map<string, Market>();
    for (const label of ["SOL", "ETH", "BTC"]) {
      out.set(label, { coin: label, label, kind: "perp" });
    }
    return out;
  },
  async fills(user, startTime, endTime, opts = {}) {
    const maxPages = opts.maxPages ?? 20;
    const legs: Leg[] = [];
    const page = 50;

    for (let i = 0; i < maxPages; i += 1) {
      const start = i * page;
      const end = start + page;
      const q = new URLSearchParams({
        walletAddress: user,
        start: String(start),
        end: String(end),
      });
      const raw = await json<{ dataList: JupTrade[]; count: number }>(
        "jupiter",
        `/v1/trades?${q}`,
        { signal: opts.signal },
      );
      const rows = raw.dataList ?? [];
      if (rows.length === 0) break;
      for (const t of rows) {
        const time = t.createdTime > 1e12 ? t.createdTime : t.createdTime * 1000;
        if (time < startTime || time > endTime) continue;
        const px = n(t.price);
        const notional = n(t.size);
        const sz = px > 0 ? notional / px : 0;
        if (px <= 0 || sz <= 0) continue;
        const long = t.side.toLowerCase() === "long";
        const open = t.action.toLowerCase() === "increase";
        const buy = open ? long : !long;
        legs.push({
          coin: coinOf(t),
          px,
          sz,
          buy,
          time,
          fee: Math.abs(n(t.fee)),
          hash: t.txHash ?? `${user}-${time}`,
          tid: time,
          closedPnl: t.action.toLowerCase() === "decrease" ? n(t.pnl) : 0,
        });
      }
      opts.onPage?.(fillsFromLegs(legs, user));
      if (rows.length < page) break;
      if (typeof raw.count === "number" && end >= raw.count) break;
    }
    return fillsFromLegs(legs, user);
  },
  async candles(coin, interval, startTime, endTime, signal) {
    const hl = coin.replace(/-PERP$/i, "").toUpperCase();
    return hlCandles(hl, interval, startTime, endTime, signal);
  },
};
