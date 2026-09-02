"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { VenueMark } from "@/components/VenueMark";
import { GALLERY } from "@/lib/notable";
import { venue as venueOf, walletPath, type VenueId } from "@/lib/venue";

const BOOKS: { id: VenueId; wide?: boolean }[] = [
  { id: "hyperliquid", wide: true },
  { id: "lighter" },
  { id: "pacifica" },
  { id: "risex" },
];

/**
 * Named wallets, grouped by the book they were found on. The card is the person;
 * opening it loads the tape.
 */
export function TraderGallery() {
  const groups = BOOKS.map((book) => ({
    ...book,
    name: venueOf(book.id)?.name ?? book.id,
    people: GALLERY.filter((n) => n.venue === book.id),
  }));
  const head = groups.find((g) => g.wide);
  const rest = groups.filter((g) => !g.wide);

  return (
    <section className="mt-16 flex flex-col gap-8">
      <h2 className="text-balance text-lead font-medium text-title">Featured traders</h2>

      {head && (
        <Book
          name={head.name}
          id={head.id}
          people={head.people}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        />
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {rest.map((g) => (
          <Book
            key={g.id}
            name={g.name}
            id={g.id}
            people={g.people}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1"
          />
        ))}
      </div>
    </section>
  );
}

function Book({
  name,
  id,
  people,
  className,
}: {
  name: string;
  id: VenueId;
  people: typeof GALLERY;
  className: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <VenueMark id={id} size={16} />
        <h3 className="rb-kicker">{name}</h3>
      </div>
      <div className={className}>
        {people.map((n) => (
          <Link
            key={`${n.venue}-${n.address}`}
            href={walletPath(n.venue, n.address)}
            className="rb-card rb-press flex min-h-16 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.03]"
          >
            <Avatar address={n.address} name={n.name} src={n.avatar} size={40} eager />
            <span className="min-w-0 text-pretty text-body font-medium leading-snug text-title">
              {n.name}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
