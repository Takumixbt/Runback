/**
 * The app mark: a film loop — frame, sprocket holes, play. The same drawing as
 * the tab icon. The glyph group sits optically centered inside the frame: equal
 * air on both sides of the holes-and-play block, play centered vertically.
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
      <rect x="14" y="15.5" width="7" height="7" rx="1.8" fill="#97fce4" />
      <rect x="14" y="28.5" width="7" height="7" rx="1.8" fill="#97fce4" />
      <rect x="14" y="41.5" width="7" height="7" rx="1.8" fill="#97fce4" />
      <path
        d="M29 20.5 L50 32 L29 43.5 Z"
        fill="#97fce4"
        stroke="#97fce4"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
