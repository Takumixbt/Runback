"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { CoinIcon } from "@/components/CoinIcon";
import { VenueMark } from "@/components/VenueMark";
import { pct, signedUsd } from "@/lib/format";
import { venue as venueOf, walletPath, type VenueId } from "@/lib/venue";
/**
 * The shapes `/api/traders` actually returns, not a second copy of them.
 *
 * These were redeclared here, and the copy had already drifted from the original:
 * no `at`, no `net`, and `side` widened to a literal union that no longer tracked
 * `Episode["side"]`. A card is rendered from whatever the route sends, so the route's
 * own types are the only ones that can be wrong in a way the compiler catches.
 *
 * Type-only, because `src/lib/traders.ts` is `server-only`. `import type` is erased
 * before bundling, so nothing server-side reaches the client graph.
 */
import type { Highlight, TraderCard } from "@/lib/traders";

const UP = "#50d2c1";
const DOWN = "#ed7088";

export function TraderGallery() {
  const [cards, setCards] = useState<TraderCard[] | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/traders")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TraderCard[]) => {
        if (alive) setCards(Array.isArray(rows) ? rows.filter((c) => c.best || c.worst) : []);
      })
      .catch(() => {
        if (alive) setCards([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (cards === null) {
    return (
      <section className="mt-16 flex flex-col gap-5">
        <h2 className="text-balance text-lead font-medium text-title">Closed trades</h2>
        <TradersSkeleton />
      </section>
    );
  }
  if (cards.length === 0) return null;

  return (
    <section className="mt-16 flex flex-col gap-5">
      <h2 className="text-balance text-lead font-medium text-title">Closed trades</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((t) => (
          <article key={`${t.venue}-${t.address}`} className="rb-card flex flex-col overflow-hidden">
            <Link
              href={walletPath(t.venue, t.address)}
              className="flex items-center gap-3 px-5 pb-4 pt-4 transition-colors duration-150 hover:bg-white/[0.03]"
            >
              <Avatar address={t.address} name={t.name} src={t.avatar} size={40} />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-lead font-medium leading-none text-title">
                  {t.name}
                </span>
                <span className="truncate text-mini leading-none text-faint">
                  {t.handle ? `@${t.handle}` : venueOf(t.venue)?.name}
                </span>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-mini text-faint">
                <VenueMark id={t.venue} size={14} />
                {t.positions} trades
              </span>
            </Link>
            <Trade tag="Best" h={t.best} wallet={t.address} venue={t.venue} />
            <Trade tag="Worst" h={t.worst} wallet={t.address} venue={t.venue} quiet />
          </article>
        ))}
      </div>
    </section>
  );
}

function Trade({
  tag,
  h,
  wallet,
  venue,
  quiet = false,
}: {
  tag: string;
  h: Highlight | null;
  wallet: string;
  venue: VenueId;
  quiet?: boolean;
}) {
  if (!h) return null;
  const tone = h.net >= 0 ? UP : DOWN;

  if (quiet) {
    return (
      <Link
        href={walletPath(venue, wallet, h.id)}
        className="flex items-center gap-2.5 border-t border-white/[0.05] px-5 py-3 text-mini transition-colors duration-150 hover:bg-white/[0.03]"
      >
        <span className="rb-kicker">{tag}</span>
        <span className="font-medium" style={{ color: tone }}>
          {signedUsd(h.net)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted">
          <CoinIcon coin={h.coin} label={h.label} size={13} />
          <span className="truncate">{h.label}</span>
        </span>
        {h.liquidated && <span className="text-micro tracking-[0.12em] text-loss">LIQ</span>}
      </Link>
    );
  }

  return (
    <Link
      href={walletPath(venue, wallet, h.id)}
      className="flex flex-col border-t border-white/[0.05] px-5 pb-5 pt-4 transition-colors duration-150 hover:bg-white/[0.03]"
    >
      <div className="flex items-center gap-2">
        <span className="rb-kicker">{tag}</span>
        {h.liquidated && (
          <span className="text-micro tracking-[0.12em] text-loss">LIQ</span>
        )}
      </div>
      <div className="mt-2.5 flex items-baseline gap-2.5">
        <span className="text-figure font-medium leading-none" style={{ color: tone }}>
          {signedUsd(h.net)}
        </span>
        {h.roe !== null && <span className="text-mini text-faint">{pct(h.roe)}</span>}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <CoinIcon coin={h.coin} label={h.label} size={16} />
        <span className="min-w-0 truncate text-body text-tx">{h.label}</span>
        <span className="shrink-0 text-micro tracking-[0.10em]" style={{ color: tone }}>
          {h.side}
        </span>
      </div>
    </Link>
  );
}

function TradersSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="hl-skeleton h-[168px] rounded-[16px]" />
      ))}
    </div>
  );
}
