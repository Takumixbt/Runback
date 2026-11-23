/**
 * The app mark: a mint tile and a play glyph — the same drawing as the tab
 * icon, rendered inline so it stays crisp at any size and inherits nothing
 * from a bitmap. The wordmark beside it is plain text, so the lockup is
 * mark + type rather than an image of both.
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
      <defs>
        <linearGradient id="rb-logo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a9ffec" />
          <stop offset="100%" stopColor="#5fdccb" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#rb-logo)" />
      <path
        d="M21.5 17.5 L44.5 32 L21.5 46.5 Z"
        fill="#0f1a1e"
        stroke="#0f1a1e"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
