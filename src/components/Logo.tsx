/**
 * The mark: a loop turning through itself.
 *
 * Not Hyperliquid's shape. Theirs is two lobes and a pinch, and copying it would just be
 * their logo in someone else's nav. This is a ring, which is the nearest honest thing to
 * what the product does, and it takes only the palette and the softness from them.
 *
 * The motion is the point. The ring is tilted back so it is read as lying in space rather
 * than drawn on glass, and it turns continuously about its vertical axis, so the far side
 * comes round through the near side and the loop feeds into itself without ever stopping.
 * Bands travelling round the tube at the same time give the surface something to move,
 * which is what stops a rotating circle from looking like a stationary one.
 */
export function Logo({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  const spin = animate
    ? "animate-[runback-spin_5.5s_linear_infinite] motion-reduce:animate-none"
    : "";
  const flow = animate
    ? "animate-[runback-flow_2.2s_linear_infinite] motion-reduce:animate-none"
    : "";

  return (
    <span
      className="inline-block shrink-0 align-middle"
      style={{ perspective: `${size * 4}px`, width: size, height: size }}
    >
      <span className={`grid h-full w-full [transform-style:preserve-3d] ${spin}`}>
        <svg viewBox="0 0 48 48" className="col-start-1 row-start-1 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="runback-tube" x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%" stopColor="#e0fff7" />
              <stop offset="42%" stopColor="#97fce4" />
              <stop offset="100%" stopColor="#3fb8a3" />
            </linearGradient>
          </defs>

          {/* The tube's shaded underside, sitting a hair below the lit face. */}
          <circle
            cx="24"
            cy="24.9"
            r="15"
            fill="none"
            stroke="#0f5f55"
            strokeWidth="7.5"
          />
          <circle
            cx="24"
            cy="24"
            r="15"
            fill="none"
            stroke="url(#runback-tube)"
            strokeWidth="7"
          />
          {/* Bands running the circumference, so the surface itself is moving. */}
          <circle
            cx="24"
            cy="24"
            r="15"
            pathLength={100}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.35"
            strokeWidth="7"
            strokeDasharray="7 18"
            className={flow}
          />
        </svg>
      </span>
    </span>
  );
}
