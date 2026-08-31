import type { VenueId } from "@/lib/venue";

/** Official marks, filed under /public/venues from each book's own icon. */
const SRC: Record<VenueId, string> = {
  hyperliquid: "/venues/hyperliquid.png",
  lighter: "/venues/lighter.png",
  risex: "/venues/risex.svg",
  drift: "/venues/drift.png",
  pacifica: "/venues/pacifica.png",
  jupiter: "/venues/jupiter.png",
  dydx: "/venues/dydx.png",
};

export function VenueMark({
  id,
  size = 16,
  className = "",
}: {
  id: VenueId;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC[id]}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 object-contain outline outline-1 outline-white/10 ${
        size <= 16 ? "rounded-[2px]" : "rounded-[4px]"
      } ${className}`}
      aria-hidden
    />
  );
}
