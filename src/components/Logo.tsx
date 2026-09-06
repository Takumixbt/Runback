/** Film loop — same mark as the tab icon. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      alt=""
      height={size}
      width={Math.round((size * 256) / 158)}
      className="shrink-0"
      style={{ height: size, width: "auto" }}
      aria-hidden
    />
  );
}
