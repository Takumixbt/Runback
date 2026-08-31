import "server-only";
import { unstable_cache } from "next/cache";
import { labelFor, type Market } from "./hl";
import { returnOf } from "./format";
import { episodes, pickWindow, type Episode } from "./episodes";
import { GALLERY, NOTABLE, type Notable } from "./notable";
import { adapter } from "./venues";
import type { VenueId } from "./venue";

/**
 * The front page cards: who, their best position, and their worst.
 *
 * Best and worst are the MAXIMUM and MINIMUM net, not the two largest by absolute size.
 * That distinction is the whole point of the section. Ranking by magnitude puts a
 * liquidation at the top of a list headed "best", which is how the earlier version managed
 * to present somebody's worst day as their highlight.
 *
 * Server-side because it is shared work: one fills walk per trader, done once for
 * everybody on a timer, rather than every visitor spending their own quota on the same few
 * wallets. It is the only server-side read in the app.
 */

const SINCE = 0;
const MAX_PAGES = 6;

const CONCURRENCY = 3;
const STAGGER_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run tasks a few at a time, in order, keeping every result. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!);
      await sleep(STAGGER_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface Highlight {
  /** Episode id, so a link can open this exact position. */
  id: string;
  coin: string;
  label: string;
  side: Episode["side"];
  net: number;
  /** Against the largest position held. Null when that denominator is unusable. */
  roe: number | null;
  at: number;
  /** Ended on a forced close, not merely containing one. */
  liquidated: boolean;
}

export interface TraderCard extends Notable {
  best: Highlight | null;
  worst: Highlight | null;
  positions: number;
  /** Sum of net across everything closed in the window. */
  net: number;
}

function highlight(ep: Episode, known: Map<string, Market>): Highlight {
  return {
    id: ep.id,
    coin: ep.coin,
    label: labelFor(ep.coin, known),
    side: ep.side,
    net: ep.net,
    roe: returnOf(ep.net, ep.peakNotional),
    at: ep.end,
    liquidated: ep.closedByLiquidation,
  };
}

/** Per-wallet budget. The gallery must not stall the homepage on a slow or throttled book. */
const CARD_MS = 8_000;

const VENUE_ORDER: Record<VenueId, number> = {
  hyperliquid: 0,
  lighter: 1,
  risex: 2,
  pacifica: 3,
  drift: 4,
  jupiter: 5,
  dydx: 6,
};

async function card(who: Notable, known: Map<string, Market>, now: number): Promise<TraderCard> {
  const blank: TraderCard = { ...who, best: null, worst: null, positions: 0, net: 0 };
  try {
    const raw = await adapter(who.venue).fills(who.address, SINCE, now, {
      maxPages: MAX_PAGES,
      signal: AbortSignal.timeout(CARD_MS),
    });
    if (raw.length === 0) return blank;

    const eps = episodes(raw, who.address).filter((e) => !e.open && pickWindow(e.start, e.end, now));
    if (eps.length === 0) return blank;

    const best = eps.reduce((m, e) => (e.net > m.net ? e : m), eps[0]!);
    const worst = eps.reduce((m, e) => (e.net < m.net ? e : m), eps[0]!);

    return {
      ...who,
      positions: eps.length,
      net: eps.reduce((sum, e) => sum + e.net, 0),
      best: best.net > 0 ? highlight(best, known) : null,
      worst: worst.net < 0 ? highlight(worst, known) : null,
    };
  } catch {
    return blank;
  }
}

/**
 * Cached PER TRADER, not per list.
 *
 * Keyed per venue + address, so Machi on Hyperliquid and Machi on Lighter are
 * separate rows, and a miss on one book does not take the other down.
 */
const cachedCard = unstable_cache(
  async (key: string): Promise<TraderCard | null> => {
    const [venueId, address] = key.split("|") as [VenueId, string];
    const who = NOTABLE.find((n) => n.venue === venueId && n.address === address);
    if (!who) return null;
    const now = Date.now();

    let known: Map<string, Market>;
    try {
      known = await adapter(who.venue).markets(AbortSignal.timeout(CARD_MS));
    } catch {
      known = new Map();
    }

    const result = await card(who, known, now);
    if (!result.best && !result.worst) return null;
    return result;
  },
  ["runback:trader:v7"],
  { revalidate: 3600 },
);

export async function traderCards(): Promise<TraderCard[]> {
  const hl = GALLERY.filter((n) => n.venue === "hyperliquid");
  const rest = [
    ...GALLERY.filter((n) => n.venue === "pacifica"),
    ...GALLERY.filter((n) => n.venue === "lighter" || n.venue === "risex"),
  ];
  const load = (rows: Notable[]) =>
    pool(rows, CONCURRENCY, (n) => cachedCard(`${n.venue}|${n.address}`).catch(() => null));

  const [a, b] = await Promise.all([load(hl), load(rest)]);
  return [...a, ...b]
    .filter((c): c is TraderCard => c !== null)
    .sort((a, b) => {
      const byBook = VENUE_ORDER[a.venue] - VENUE_ORDER[b.venue];
      if (byBook !== 0) return byBook;
      return (b.best?.net ?? 0) - (a.best?.net ?? 0);
    });
}
