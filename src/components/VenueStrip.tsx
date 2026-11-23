import { VENUES } from "@/lib/venue";
import { VenueMark } from "./VenueMark";

/**
 * Every book the app can read, as marks.
 *
 * The venue list is the product's breadth claim, and a wall of names is reading;
 * a wall of logos is recognition. Each chip is inert on purpose — there is no
 * per-venue page to land on, and a dead link is worse than none.
 */
export function VenueStrip() {
  return (
    <section className="mt-16 flex flex-col items-center gap-4 border-y border-white/[0.05] py-7">
      <p className="text-mini text-faint">
        Ten books publish a public tape. This reads all of them.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 px-2">
        {VENUES.map((v) => (
          <span
            key={v.id}
            className="flex items-center gap-1.5 text-mini text-muted"
            title={v.chain}
          >
            <VenueMark id={v.id} size={16} />
            {v.name}
          </span>
        ))}
      </div>
    </section>
  );
}
