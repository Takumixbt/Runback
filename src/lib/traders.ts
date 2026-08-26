import "server-only";
import { unstable_cache } from "next/cache";
import { fills, labelFor, markets, type Market } from "./hl";
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

const LOOKBACK_DAYS = 45;
/** Enough to reach real size without walking a market maker's entire tape. */
const MAX_PAGES = 4;

export interface Highlight {
  coin: string;
  label: string;
  side: Episode["side"];
  net: number;
  roe: number;
  at: number;
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
    coin: ep.coin,
    label: labelFor(ep.coin, known),
    side: ep.side,
    net: ep.net,
    roe: ep.peakNotional > 0 ? ep.net / ep.peakNotional : 0,
    at: ep.end,
    liquidated: ep.liquidated,
  };
}

async function card(who: Notable, known: Map<string, Market>, now: number): Promise<TraderCard> {
  const blank: TraderCard = { ...who, best: null, worst: null, positions: 0, net: 0 };
  try {
    const raw = await fills(who.address, now - LOOKBACK_DAYS * 86_400_000, now, {
      maxPages: MAX_PAGES,
    });
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
    return blank;
  }
}

export const traderCards = unstable_cache(
  async (): Promise<TraderCard[]> => {
    if (NOTABLE.length === 0) return [];
    const now = Date.now();

    let known: Map<string, Market>;
    try {
      known = await markets();
    } catch {
      known = new Map();
    }

    const settled = await Promise.allSettled(NOTABLE.map((n) => card(n, known, now)));
    return settled
      .map((s, i) =>
        s.status === "fulfilled"
          ? s.value
          : { ...NOTABLE[i]!, best: null, worst: null, positions: 0, net: 0 },
      )
      .sort((a, b) => (b.best?.net ?? 0) - (a.best?.net ?? 0));
  },
  ["runback:traders"],
  { revalidate: 300 },
);
