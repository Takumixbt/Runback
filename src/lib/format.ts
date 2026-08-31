/** Formatting helpers. Every figure they return is meant to be set in mono. */

function trim(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

/** $412K, $1.2M, $61.4K, the volume and notional convention. */
export function usdCompact(value: number): string {
  if (value >= 1_000_000_000) return `$${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `$${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `$${trim(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/**
 * A PnL figure, always carrying its sign.
 *
 * A minus sign rather than a hyphen: at the type sizes the export uses, a hyphen next
 * to tabular digits reads as a dash between them rather than as a negative.
 */
export function signedUsd(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${usdCompact(abs)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * A return, or nothing, because some positions cannot have one.
 *
 * Return is net over the largest position held, and that denominator collapses on a
 * position whose size never really grew: a spot leg opened and closed within rounding, a
 * transfer booked as a fill. MEASURED, one produced "+10,474,240.3%" on the front page.
 *
 * A figure that absurd is not a big win, it is a missing denominator, and printing it
 * costs more trust than leaving the cell empty. Returns are suppressed below a floor on
 * the notional and above a ceiling on the result.
 */
const MIN_NOTIONAL_FOR_RETURN = 500;
const MAX_SANE_RETURN = 100;

export function returnOf(net: number, peakNotional: number): number | null {
  if (!Number.isFinite(net) || !Number.isFinite(peakNotional)) return null;
  if (peakNotional < MIN_NOTIONAL_FOR_RETURN) return null;
  const r = net / peakNotional;
  if (!Number.isFinite(r) || Math.abs(r) > MAX_SANE_RETURN) return null;
  return r;
}

export function pct(v: number, digits = 1): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(v) * 100).toFixed(digits)}%`;
}

/**
 * A price, at whatever precision it actually needs.
 *
 * Hyperliquid lists BTC near 79,000 and spot pairs at four zeros after the point, and a
 * fixed decimal count is wrong for one of them however it is chosen.
 */
export function price(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (abs >= 1) return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (abs >= 0.001) return v.toFixed(6).replace(/0+$/, "");
  return v.toPrecision(4);
}

/** A size, without pretending to a precision the coin does not have. */
export function size(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

/** 34m, 3.7h, 2.1d. How long the position was held. */
export function duration(ms: number): string {
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)}s`;
  const m = s / 60;
  if (m < 90) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** Middle-truncated, so both ends of an address stay readable. */
export function shortAddress(v: string, keep = 6): string {
  return v.length <= keep * 2 + 1 ? v : `${v.slice(0, keep)}…${v.slice(-keep)}`;
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
