import { VENUE_MARK, type VenueId } from "@/lib/venue";

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
      src={VENUE_MARK[id]}
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
