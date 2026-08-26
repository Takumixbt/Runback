/**
 * The one box this app draws.
 *
 * Hyperliquid's terminal is built almost entirely from these: a 1px border in the border
 * token over the page ground, a low header strip carrying a small label and an optional
 * right-hand aside, and content below. No shadows, no filled cards, no nesting. Getting
 * this one primitive right is most of what makes a page read as theirs.
 */
export function Panel({
  label,
  aside,
  children,
  className = "",
  bodyClassName = "",
  flush = false,
}: {
  label?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Content sits against the border, for tables and charts that supply their own padding. */
  flush?: boolean;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-[8px] border border-border bg-ground ${className}`}
    >
      {(label || aside) && (
        <header className="flex h-[34px] shrink-0 items-center justify-between gap-3 border-b border-border px-3">
          {label && (
            <span className="text-[10px] tracking-[0.08em] text-faint">{label}</span>
          )}
          {aside && <div className="flex items-center gap-2 text-[11px]">{aside}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${flush ? "" : "p-3"} ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}

/** A label over a figure, the unit Hyperliquid's summary strips are made of. */
export function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  /** Signed number driving the colour. Omit for neutral. */
  tone?: number;
  sub?: string;
}) {
  const color = tone === undefined ? "#f6fefd" : tone >= 0 ? "#50d2c1" : "#ed7088";
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
      <span className="truncate text-[10px] tracking-[0.08em] text-faint">{label}</span>
      <span className="truncate text-[14px] leading-none tabular-nums" style={{ color }}>
        {value}
      </span>
      {sub && <span className="truncate text-[10px] text-faint">{sub}</span>}
    </div>
  );
}
