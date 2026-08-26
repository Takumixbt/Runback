/**
 * The mark: an infinity, made of liquid.
 *
 * One colour, Hyperliquid's mint, and nothing else. No dark plate behind it, no second
 * tone underneath it, no outline. Everything that makes it read as a solid thing in space
 * comes from movement and from opacity, because a shape that needs a shadow to look round
 * is a drawing of a round thing.
 *
 * Two motions run at once and neither ever resolves:
 *
 *   flow    a bright head runs the loop, crossing its own middle forever. This is the one
 *           that reads as liquid: the surface is going somewhere, continuously, and an
 *           infinity is the only path where "somewhere" never ends.
 *   swell   the whole form leans through three axes on a slow cycle out of step with the
 *           flow, so it never repeats the same pose twice in a row and never flattens.
 *
 * The ripple is a turbulence displacement animated in the filter itself. It is what stops
 * the stroke reading as a pipe: the edges wander the way a liquid's do, slowly, without
 * ever losing the silhouette.
 */
export function Logo({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  const id = "runback-liquid";
  return (
    <span
      className="inline-block shrink-0 align-middle"
      style={{ perspective: `${size * 3.4}px`, width: size, height: (size * 34) / 64 }}
    >
      <span
        className={`grid h-full w-full [transform-style:preserve-3d] ${
          animate ? "animate-[runback-swell_6.5s_ease-in-out_infinite] motion-reduce:animate-none" : ""
        }`}
      >
        <svg viewBox="0 0 64 34" className="col-start-1 row-start-1 h-full w-full" aria-hidden>
          <defs>
            <filter id={id} x="-25%" y="-45%" width="150%" height="190%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.016 0.03"
                numOctaves={2}
                seed={7}
                result="noise"
              >
                {animate && (
                  <animate
                    attributeName="baseFrequency"
                    dur="9s"
                    values="0.016 0.03; 0.026 0.018; 0.016 0.03"
                    repeatCount="indefinite"
                  />
                )}
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={2.4}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>

          <g filter={`url(#${id})`}>
            {/* The body of the liquid. */}
            <path d={PATH} fill="none" stroke="#97fce4" strokeWidth="6.5" strokeOpacity="0.34" />
            {/* Its weight, sitting inside the body rather than under it. */}
            <path d={PATH} fill="none" stroke="#97fce4" strokeWidth="4.2" strokeOpacity="0.62" />
            {/* The head, running. */}
            <path
              d={PATH}
              pathLength={100}
              fill="none"
              stroke="#97fce4"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="16 84"
              className={
                animate
                  ? "animate-[runback-flow_2.8s_linear_infinite] motion-reduce:animate-none"
                  : undefined
              }
            />
          </g>
        </svg>
      </span>
    </span>
  );
}

/**
 * A lemniscate as one unbroken curve.
 *
 * One path, not two loops, because the head has to cross the middle without stopping.
 * Two shapes would each restart the dash at their own start point and the liquid would
 * stutter every time it reached the crossing.
 */
const PATH =
  "M32,17 C32,9 27,5.5 21,5.5 C12.8,5.5 7.5,10.8 7.5,17 " +
  "C7.5,23.2 12.8,28.5 21,28.5 C27,28.5 32,25 32,17 " +
  "C32,9 37,5.5 43,5.5 C51.2,5.5 56.5,10.8 56.5,17 " +
  "C56.5,23.2 51.2,28.5 43,28.5 C37,28.5 32,25 32,17 Z";
