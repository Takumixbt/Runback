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
  flush?: boolean;
}) {
  return (
    <section className={`rb-card flex min-w-0 flex-col overflow-hidden ${className}`}>
      {(label || aside) && (
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/5 px-5">
          {label && (
            <span className="text-micro font-medium tracking-[0.14em] text-faint">{label}</span>
          )}
          {aside && <div className="flex items-center gap-2 text-mini">{aside}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${flush ? "" : "p-4"} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: number;
  sub?: string;
}) {
  const color = tone === undefined ? "#f6fefd" : tone >= 0 ? "#50d2c1" : "#ed7088";
  return (
    <div className="flex min-w-0 flex-col justify-center gap-2.5 bg-[#101c21] px-5 py-5">
      <span className="truncate text-micro font-medium tracking-[0.14em] text-faint">{label}</span>
      <span className="truncate text-[1.35rem] font-medium leading-none tabular-nums" style={{ color }}>
        {value}
      </span>
      {sub && <span className="truncate text-micro text-faint">{sub}</span>}
    </div>
  );
}
