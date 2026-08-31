/** A mint infinity. Still, no 3D, no filter — the wordmark does the talking. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 34"
      width={size}
      height={(size * 34) / 64}
      className="shrink-0"
      aria-hidden
    >
      <path
        d={PATH}
        fill="none"
        stroke="#97fce4"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PATH =
  "M32,17 C32,9 27,5.5 21,5.5 C12.8,5.5 7.5,10.8 7.5,17 " +
  "C7.5,23.2 12.8,28.5 21,28.5 C27,28.5 32,25 32,17 " +
  "C32,9 37,5.5 43,5.5 C51.2,5.5 56.5,10.8 56.5,17 " +
  "C56.5,23.2 51.2,28.5 43,28.5 C37,28.5 32,25 32,17 Z";
