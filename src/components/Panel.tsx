export function Panel({
  label,
  aside,
  children,
  className = "",
  flush = false,
}: {
  label?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`rb-card flex min-w-0 flex-col overflow-hidden ${className}`}>
      {(label || aside) && (
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] px-5">
          {label && <span className="rb-kicker">{label}</span>}
          {aside && <div className="flex items-center gap-2 text-mini">{aside}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${flush ? "" : "p-4"}`}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  const color = tone === undefined ? "#f6fefd" : tone >= 0 ? "#50d2c1" : "#ed7088";
  return (
    <div className="flex min-w-0 flex-col justify-center gap-2 px-5 py-5">
      <span className="rb-kicker truncate">{label}</span>
      <span className="truncate text-title font-medium leading-none" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
