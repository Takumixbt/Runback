/**
 * The mark: a lemniscate, drawn as one unbroken stroke, with a bright segment running
 * around it forever.
 *
 * Hyperliquid's own logo is an organic mint form with no straight edges and no corners,
 * and read closely it is two lobes meeting at a pinch, which is an infinity. So the shape
 * is theirs and the motion is ours: a loop that never resolves is the product, and the
 * travelling segment says "running" without a spinner or a pulse.
 *
 * `pathLength={100}` normalises the geometry so the dash lengths below are percentages and
 * the animation does not have to know the real arc length.
 */
export function Logo({ size = 26, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <svg
      viewBox="0 0 48 26"
      width={(size * 48) / 26}
      height={size}
      fill="none"
      aria-hidden
      className="shrink-0 overflow-visible"
    >
      <path
        d={PATH}
        pathLength={100}
        stroke="#1d4a45"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <path
        d={PATH}
        pathLength={100}
        stroke="#97fce4"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray="22 78"
        className={
          animate
            ? "animate-[runback-trace_3.2s_linear_infinite] motion-reduce:animate-none"
            : undefined
        }
      />
    </svg>
  );
}

/**
 * Two lobes meeting at the centre, as a single continuous curve.
 *
 * One path rather than two circles, because the travelling segment has to cross the pinch
 * without stopping. Two shapes would each restart the dash at their own start point and
 * the motion would stutter in the middle.
 */
const PATH =
  "M24,13 C24,6.6 20.2,3.4 15.6,3.4 C9.9,3.4 6.4,7.6 6.4,13 " +
  "C6.4,18.4 9.9,22.6 15.6,22.6 C20.2,22.6 24,19.4 24,13 " +
  "C24,6.6 27.8,3.4 32.4,3.4 C38.1,3.4 41.6,7.6 41.6,13 " +
  "C41.6,18.4 38.1,22.6 32.4,22.6 C27.8,22.6 24,19.4 24,13 Z";
