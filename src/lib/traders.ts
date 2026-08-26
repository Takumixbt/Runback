import "server-only";
import { unstable_cache } from "next/cache";
import { fills, labelFor, markets, type Market } from "./hl";
import { returnOf } from "./format";
import { episodes, pickWindow, type Episode } from "./episodes";
import { NOTABLE, type Notable } from "./notable";

/**
 * The front page cards: who, their best position, and their worst.
 *
 * Best and worst are the MAXIMUM and MINIMUM net, not the two largest by absolute size.
 * That distinction is the whole point of the section. Ranking by magnitude puts a
 * liquidation at the top of a list headed "best", which is how the earlier version managed
 * to present somebody's worst day as their highlight.
 *
 * Server-side because it is shared work: one `userFills` walk per trader, done once for
 * everybody on a timer, rather than every visitor spending their own quota on the same few
 * wallets. It is the only server-side read in the app.
 */

/**
 * The whole record, not a window onto it.
 *
 * A 400-day lookback was cutting off exactly what the section exists to show. MEASURED on
 * James Wynn: the window opened on 2025-07-22 and his account starts 2025-03-13, so the
 * BTC position that made $12.6M and the one that lost $20.6M five days later both fell
 * outside it, and the card advertised a $135K kPEPE trade as his best. Those two are the
 * whole reason anyone knows his name.
 *
 * Reading from zero costs a few more pages on a cache that lasts an hour, and a best and
 * worst on record does not change often enough to justify anything shorter. Old does not
 * mean undrawable either: 4h bars reach back over two years, so both of Wynn's are still
 * replayable.
 */
const SINCE = 0;
const MAX_PAGES = 12;

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

async function card(who: Notable, known: Map<string, Market>, now: number): Promise<TraderCard> {
  const blank: TraderCard = { ...who, best: null, worst: null, positions: 0, net: 0 };
  try {
    const raw = await fills(who.address, SINCE, now, { maxPages: MAX_PAGES });
    if (raw.length === 0) return blank;

    /** Only what can actually be watched. A card that opens onto nothing is worse than none. */
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
    /**
     * Re-thrown, not swallowed into a blank card.
     *
     * A blank is indistinguishable from "this wallet has no history", so caching one hides
     * a rate limit for five minutes and the trader just disappears from the page. The
     * caller drops the whole result instead, which means the next request retries.
     */
    throw new Error(`runback: could not read ${who.address}`);
  }
}

/**
 * Cached PER TRADER, not per list.
 *
 * One cache entry for the whole list meant one slow or throttled wallet took the others
 * down with it: MEASURED, three of six rendered and the rest simply vanished, because a
 * batch either succeeds whole or is thrown away whole. Machi and CBB are the heaviest
 * reads on the list and were the two that kept losing.
 *
 * Keyed per address, a failure costs only that row, and the next request retries just that
 * row while the others answer from cache. The list fills in over a couple of loads instead
 * of flickering between three names and six.
 */
const cachedCard = unstable_cache(
  async (address: string): Promise<TraderCard | null> => {
    const who = NOTABLE.find((n) => n.address === address);
    if (!who) return null;
    const now = Date.now();

    let known: Map<string, Market>;
    try {
      known = await markets();
    } catch {
      known = new Map();
    }

    const result = await card(who, known, now);
    // Nothing worth showing is not cached, so a throttled read is retried rather than kept.
    if (!result.best && !result.worst) throw new Error(`runback: empty ${address}`);
    return result;
  },
  ["runback:trader"],
  { revalidate: 3600 },
);

export async function traderCards(): Promise<TraderCard[]> {
  const cards = await pool(NOTABLE, CONCURRENCY, (n) =>
    cachedCard(n.address).catch(() => null),
  );
  return cards
    .filter((c): c is TraderCard => c !== null)
    .sort((a, b) => (b.best?.net ?? 0) - (a.best?.net ?? 0));
}
