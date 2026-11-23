/**
 * The app mark: a film loop — frame, sprocket holes, play. The same drawing as
 * the tab icon, rendered inline so it stays crisp at any size. The frame runs
 * near edge to edge inside the tile; the mark should read as full, not inset.
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="shrink-0"
      aria-hidden
    >
      <rect width="64" height="64" rx="15" fill="#0f1a1e" />
      <rect x="5" y="5" width="54" height="54" rx="10" fill="none" stroke="#97fce4" strokeWidth="5" />
      <rect x="11.5" y="15.5" width="7" height="7" rx="1.8" fill="#97fce4" />
      <rect x="11.5" y="28.5" width="7" height="7" rx="1.8" fill="#97fce4" />
      <rect x="11.5" y="41.5" width="7" height="7" rx="1.8" fill="#97fce4" />
      <path
        d="M26.5 20.5 L47.5 32 L26.5 43.5 Z"
        fill="#97fce4"
        stroke="#97fce4"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
