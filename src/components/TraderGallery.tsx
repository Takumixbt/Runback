"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { VenueMark } from "@/components/VenueMark";
import { GALLERY } from "@/lib/notable";
import { venue as venueOf, walletPath } from "@/lib/venue";

/**
 * Named wallets, face first.
 *
 * Only traders with a real picture are featured — a row of avatars is the
 * section's whole visual argument. Each card carries the book it was found on,
 * so the mark still teaches the pattern the search field promises: the same
 * address is a different tape on every venue.
 */
export function TraderGallery() {
  if (GALLERY.length === 0) return null;

  return (
    <section className="mt-20 flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-balance text-lead font-medium tracking-tight text-title">
          Featured traders
        </h2>
        <span className="text-mini text-faint">named on their own book</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GALLERY.map((n) => {
          const book = venueOf(n.venue);
          return (
            <Link
              key={`${n.venue}-${n.address}`}
              href={walletPath(n.venue, n.address)}
              className="rb-card rb-press group flex min-h-[76px] items-center gap-3.5 px-4 py-3.5 transition-[border-color,background-color,box-shadow] duration-200 hover:border-white/12 hover:bg-white/[0.02] hover:shadow-[0_18px_44px_-24px_#000000cc]"
            >
              <Avatar address={n.address} name={n.name} src={n.avatar} size={48} eager />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body font-medium text-title">{n.name}</span>
                <span className="truncate text-mini text-faint">
                  {n.handle ? `@${n.handle}` : (book?.name ?? n.venue)}
                </span>
              </span>
              <VenueMark id={n.venue} size={20} className="opacity-80" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
