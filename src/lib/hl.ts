/**
 * The whole Hyperliquid data layer.
 *
 * Isomorphic on purpose. The info endpoint answers `access-control-allow-origin: *`,
 * so the browser can call it directly, and that is not a detail: Hyperliquid's rate
 * limit is 1,200 weight per minute PER IP. Called from the browser every visitor
 * spends their own quota and the app has no ceiling and no server cost. Called from
 * a Vercel function every visitor spends the same shared quota and the app falls over
 * at a few dozen concurrent users.
 *
 * So: everything a visitor triggers runs client-side.
 */

export const INFO = "https://api.hyperliquid.xyz/info";

/**
 * Every numeric field on this API is a decimal string. Parse at the boundary, once.
 *
 * Non-finite parses become 0: one NaN reaching a running total turns a whole
 * episode's PnL and drawdown into NaN, which renders as nothing at all.
 */
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

async function info<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hyperliquid ${res.status}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ fills */

/** A fill exactly as the API returns it, before parsing. */
interface RawFill {
  coin: string;
  px: string;
  sz: string;
  side: "A" | "B";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  feeToken?: string;
  tid: number;
  twapId?: number | null;
  liquidation?: { liquidatedUser: string; markPx: string; method: string };
}

export interface Fill {
  coin: string;
  /** The real execution price. Not a bar mark, which is what a Solana replay has to settle for. */
  px: number;
  sz: number;
  /** A = ask = sell, B = bid = buy. */
  side: "A" | "B";
  time: number;
  /** Position size before this fill. Free cross-check on our own running total. */
  startPosition: number;
  /** "Open Long" | "Close Long" | "Open Short" | "Close Short" | "Long > Short" | "Buy" | "Sell" */
  dir: string;
  /** Realised USD on this fill alone, computed by Hyperliquid. BEFORE fees. */
  closedPnl: number;
  fee: number;
  /** Can be UBTC and friends on spot, which is why fees are only summed when this is USDC. */
  feeToken: string;
  crossed: boolean;
  hash: string;
  tid: number;
  twapId: number | null;
  /**
   * The address that got liquidated, when this fill was part of a forced close.
   *
   * Not a boolean, and that matters. A liquidation produces TWO fills sharing a tid: the
   * liquidated user's and the counterparty's, and BOTH carry this object. Treating its
   * presence as "this wallet was liquidated" marks whoever took the other side as blown
   * up too, which is how a wallet's single best position ended up wearing a LIQ badge.
   */
  liquidatedUser: string | null;
}

const parseFill = (f: RawFill): Fill => ({
  coin: f.coin,
  px: n(f.px),
  sz: n(f.sz),
  side: f.side,
  time: f.time,
  startPosition: n(f.startPosition),
  dir: f.dir ?? "",
  closedPnl: n(f.closedPnl),
  fee: n(f.fee),
  feeToken: f.feeToken ?? "USDC",
  crossed: !!f.crossed,
  hash: f.hash,
  tid: f.tid,
  twapId: f.twapId ?? null,
  liquidatedUser: f.liquidation?.liquidatedUser?.toLowerCase() ?? null,
});

/** One response can hold this many; more than this means there is another page. */
const PAGE = 2000;

/**
 * Every fill in a window, oldest first.
 *
 * Recent first, then older. `userFills` is one round trip and the 2,000 most recent
 * prints — enough to paint a catalogue. `userFillsByTime` walks forward from genesis,
 * so using it as the first page made a wallet feel empty until seventeen months of
 * history had been pulled. We still walk back when the caller asks for more pages.
 *
 * `aggregateByTime` merges partial fills that landed at the same instant. On by default:
 * a market order that swept four levels is one decision and should be one marker.
 */
export async function fills(
  user: string,
  startTime: number,
  endTime: number,
  opts: {
    maxPages?: number;
    signal?: AbortSignal;
    onPage?: (soFar: Fill[]) => void;
  } = {},
): Promise<Fill[]> {
  const maxPages = opts.maxPages ?? 3;
  const seen = new Set<number>();
  const out: Fill[] = [];

  const recent = await info<RawFill[]>(
    { type: "userFills", user, aggregateByTime: true },
    opts.signal,
  );
  if (Array.isArray(recent) && recent.length) {
    const parsed = recent
      .map(parseFill)
      .filter((f) => f.time >= startTime && f.time <= endTime)
      .sort((a, b) => a.time - b.time || a.tid - b.tid);
    for (const f of parsed) {
      if (seen.has(f.tid)) continue;
      seen.add(f.tid);
      out.push(f);
    }
    opts.onPage?.(out);
  }
  if (!Array.isArray(recent) || recent.length === 0) {
    let cursor = startTime;
    for (let i = 0; i < maxPages; i += 1) {
      const page = await info<RawFill[]>(
        { type: "userFillsByTime", user, startTime: cursor, endTime, aggregateByTime: true },
        opts.signal,
      );
      if (!Array.isArray(page) || !page.length) break;
      for (const raw of page) {
        const f = parseFill(raw);
        if (seen.has(f.tid)) continue;
        seen.add(f.tid);
        out.push(f);
      }
      opts.onPage?.(out);
      if (page.length < PAGE) break;
      cursor = page[page.length - 1]!.time + 1;
    }
    return out;
  }

  const cap = out.length > 0 ? out[0]!.time : endTime;
  let cursor = startTime;
  for (let i = 1; i < maxPages; i += 1) {
    if (cursor >= cap) break;
    const page = await info<RawFill[]>(
      { type: "userFillsByTime", user, startTime: cursor, endTime: cap, aggregateByTime: true },
      opts.signal,
    );
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const f = parseFill(raw);
      if (f.time < startTime || f.time > endTime || seen.has(f.tid)) continue;
      seen.add(f.tid);
      out.push(f);
    }
    out.sort((a, b) => a.time - b.time || a.tid - b.tid);
    opts.onPage?.(out);
    if (page.length < PAGE) break;
    cursor = page[page.length - 1]!.time + 1;
  }
  return out;
}

/* ---------------------------------------------------------------- candles */

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** Trade count in the bar. Useful for spotting a bar that is one print. */
  n: number;
}

interface RawCandle {
  t: number; T: number; s: string; i: string;
  o: string; c: string; h: string; l: string; v: string; n: number;
}

/**
 * Bars for a window.
 *
 * Serves perps ("BTC"), spot ("@142") and HIP-3 builder markets ("xyz:AAPL") through the
 * same call with the same shape, so nothing downstream needs to know which it got.
 *
 * Returns [] rather than an error when the window is outside what the interval can reach.
 * That silence is the single most common way to end up rendering an empty chart, so
 * `pickInterval` decides the interval before anyone calls this.
 */
export async function candles(
  coin: string,
  interval: string,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const raw = await info<RawCandle[]>(
    { type: "candleSnapshot", req: { coin, interval, startTime, endTime } },
    signal,
  );
  return raw.map((b) => ({
    t: b.t, o: n(b.o), h: n(b.h), l: n(b.l), c: n(b.c), v: n(b.v), n: b.n,
  }));
}

/* ----------------------------------------------------------------- meta */

export interface Market {
  /** What the API calls it. "BTC", "@142", "xyz:AAPL". */
  coin: string;
  /** What a human calls it. "BTC", "HYPE/USDC", "AAPL". */
  label: string;
  kind: "perp" | "spot" | "builder";
  maxLeverage?: number;
}

interface PerpUniverse { name: string; maxLeverage?: number; isDelisted?: boolean }
interface SpotToken { name: string; index: number }
interface SpotPair { name: string; index: number; tokens: [number, number] }

let marketsMemo: { at: number; data: Map<string, Market> } | null = null;
const MARKETS_MS = 60_000;

/**
 * Display names for every market, so a replay is never titled "@142".
 *
 * Three namespaces in one list. Spot pairs arrive as "@N" with the real ticker only
 * reachable by joining the pair's token indices back to the token table, and HIP-3
 * markets arrive already prefixed by their deployer.
 */
export async function markets(signal?: AbortSignal): Promise<Map<string, Market>> {
  if (marketsMemo && Date.now() - marketsMemo.at < MARKETS_MS) return marketsMemo.data;
  const out = new Map<string, Market>();

  const [perp, spot] = await Promise.all([
    info<{ universe: PerpUniverse[] }>({ type: "meta" }, signal),
    info<{ universe: SpotPair[]; tokens: SpotToken[] }>({ type: "spotMeta" }, signal),
  ]);

  for (const a of perp.universe) {
    if (a.isDelisted) continue;
    out.set(a.name, { coin: a.name, label: a.name, kind: "perp", maxLeverage: a.maxLeverage });
  }

  const token = new Map(spot.tokens.map((t) => [t.index, t.name]));
  for (const pair of spot.universe) {
    const base = token.get(pair.tokens[0]);
    const quote = token.get(pair.tokens[1]);
    const label = base && quote ? `${base}/${quote}` : pair.name;
    // Canonical pairs already carry a readable name; the rest are "@N".
    out.set(pair.name, { coin: pair.name, label, kind: "spot" });
    out.set(`@${pair.index}`, { coin: `@${pair.index}`, label, kind: "spot" });
  }

  marketsMemo = { at: Date.now(), data: out };
  return out;
}

/** Fallback for a coin the meta call did not cover, so nothing renders blank. */
export function labelFor(coin: string, known: Map<string, Market> | null): string {
  const hit = known?.get(coin);
  if (hit) return hit.label;
  // "xyz:AAPL" -> "AAPL", tagged as a builder market by the caller.
  if (coin.includes(":")) return coin.split(":")[1] ?? coin;
  return coin;
}

export function kindOf(coin: string, known: Map<string, Market> | null): Market["kind"] {
  if (coin.includes(":")) return "builder";
  return known?.get(coin)?.kind ?? "perp";
}

/* -------------------------------------------------------------- discovery */

export interface Print {
  coin: string;
  px: number;
  sz: number;
  time: number;
  users: [string, string];
}

/**
 * Live wallet addresses, straight off the tape.
 *
 * Every print carries both sides of the fill, which makes this a free and continuous
 * source of real, currently-active wallets. The alternative is the leaderboard file,
 * which is multiple megabytes and slow enough to time out on a cold connection.
 */
export async function recentTrades(coin: string, signal?: AbortSignal): Promise<Print[]> {
  const raw = await info<{ coin: string; px: string; sz: string; time: number; users: [string, string] }[]>(
    { type: "recentTrades", coin },
    signal,
  );
  return raw.map((t) => ({ coin: t.coin, px: n(t.px), sz: n(t.sz), time: t.time, users: t.users }));
}

/* ------------------------------------------------------------------ misc */

export const isAddress = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
