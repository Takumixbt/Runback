/**
 * One frame of an exported clip, painted.
 *
 * The screen shows the chart with a header above it and figures below, all of it HTML.
 * The chart library knows nothing about any of that, so a recording made by screenshotting
 * the chart carries the chart alone. This draws the rest back on at full resolution, laid
 * out for whichever shape is being exported.
 *
 * Everything here is authored against the 1920-wide frame and multiplied by `layout.type`,
 * so one set of numbers describes all three formats.
 *
 */

import { DESIGN_W, type Layout } from "@/lib/clip";
import { pct, price, shortAddress, signedUsd, usdCompact } from "@/lib/format";

/**
 * Inter, which is the face Hyperliquid ships under the name "OurFont".
 *
 * Canvas cannot wait for a webfont, so the export is started only after the page has one:
 * `document.fonts.ready` is awaited in `export.ts` before the first frame is painted.
 */
const FACE = 'Inter, system-ui, "Segoe UI", Roboto, sans-serif';

/** Hyperliquid's own tokens, mirrored from the `@theme` block in globals.css. */
const GROUND = "#0f1a1e";
const TX = "#f6fefd";
const TX2 = "#9aa3a4";
const TX3 = "#9aa3a4";
const MINT = "#50d2c1";
const SIGNAL = "#ed7088";
const AMBER = "#97fce4";
const LINE = "#273035";

/**
 * A floating fill label, with its envelopes already resolved.
 *
 * The exporter works these out because it is the thing that knows what time it is in
 * the clip; the painter only draws what it is handed.
 */
export interface PaintFill {
  isBuy: boolean;
  liquidation: boolean;
  usd: number;
  /** Volume-weighted price of the fills the label sums. */
  px: number;
  /** Which row it occupies, so several at once do not stack on each other. */
  slot: number;
  /** Label opacity, 0..1. */
  alpha: number;
  /**
   * Wash opacity, 0..1, on its own 900ms curve — and zero the moment the label starts
   * leaving, because the screen only renders a wash for fills that are not on their
   * way out.
   */
  wash: number;
  /** Leaving, which reverses the drift. */
  out: boolean;
}

/** The running position at one bar of the replay, as the stats band shows it. */
export interface FramePoint {
  realized: number;
  unrealized: number;
  total: number;
  fees: number;
  qty: number;
  price: number;
}

export interface FrameState {
  layout: Layout;
  /** The chart exactly as drawn, at export resolution. */
  shot: HTMLCanvasElement | null;
  label: string;
  wallet: string;
  /** Book this trade was taken on. */
  venue: string;
  /** Optional venue mark, drawn next to the book name. */
  venueMark: CanvasImageSource | null;
  side: "LONG" | "SHORT" | "FLIP";
  /** Running totals at this instant of the replay. */
  total: number;
  qty: number;
  avgEntry: number;
  /** The position at the current bar, which is what makes the stats band move. */
  point: FramePoint | null;
  /** Fills landed up to the current bar. */
  trades: number;
  fills: PaintFill[];
  liquidated: boolean;
  open: boolean;
  /** 0 while the replay runs; 0..1 across the end card. */
  outro: number;
  /** Final figures, for the end card. */
  final: {
    net: number;
    realized: number;
    fees: number;
    roe: number;
    peak: number;
    trough: number;
    /** Already formatted; the painter does not know what a duration is. */
    held: string;
  };
}

interface TextOptions {
  size: number;
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  tracking?: number;
  alpha?: number;
}

function draw(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: TextOptions,
): number {
  ctx.save();
  ctx.font = `${o.weight ?? 400} ${o.size}px ${FACE}`;
  ctx.fillStyle = o.color ?? TX;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  // Not every engine supports letter spacing on a canvas; where it is missing the
  // assignment is ignored and the text is a touch tighter.
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${o.tracking ?? 0}px`;
  ctx.fillText(s, x, y);
  const width = ctx.measureText(s).width;
  ctx.restore();
  return width;
}

const toneOf = (v: number): string => (v >= 0 ? MINT : SIGNAL);

const sideColor = (side: FrameState["side"]): string =>
  side === "LONG" ? MINT : side === "SHORT" ? SIGNAL : AMBER;

/** The same smoothstep the replay eases with. */
function ease(p: number): number {
  const c = Math.min(Math.max(p, 0), 1);
  return c * c * (3 - 2 * c);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function paint(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const L = s.layout;

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, L.w, L.h);

  paintHeader(ctx, s);

  if (s.shot) {
    /**
     * Explicit source and destination boxes rather than a bare `drawImage`. At a
     * fractional device pixel ratio the chart's CSS size rounds to the device grid, so
     * its bitmap can come back a pixel off the rect it was sized for.
     */
    ctx.drawImage(
      s.shot,
      0, 0, s.shot.width, s.shot.height,
      L.chart.x, L.chart.y, L.chart.w, L.chart.h,
    );
  }

  paintStats(ctx, s);

  // Wash last but one: it has to cross the chart's edge and the figures below it,
  // with only the labels sitting on top.
  const placed = placeFills(ctx, s);
  paintWash(ctx, s, placed);
  paintFillLabels(ctx, placed);

  if (s.outro > 0) paintOutro(ctx, s);
}

function paintHeader(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const L = s.layout;
  const t = L.type;
  const r = L.header;
  const wide = L.shape === "landscape";

  const pad = L.pad;
  const baseline = r.y + r.h - 34 * t;

  /* --- left: market, side badge, wallet ------------------------------- */

  const marketSize = 54 * t;
  const w = draw(ctx, s.label, pad, baseline, {
    size: marketSize,
    weight: 500,
    tracking: -1.5 * t,
  });

  // The badge sits on the market's baseline rather than centred on it: at this size the
  // cap heights line up and a true vertical centre reads as sitting low.
  const badge = s.side;
  const badgeSize = 20 * t;
  ctx.save();
  ctx.font = `500 ${badgeSize}px ${FACE}`;
  const bw = ctx.measureText(badge).width + 18 * t;
  const bh = badgeSize + 14 * t;
  const bx = pad + w + 18 * t;
  const by = baseline - bh + 6 * t;
  ctx.fillStyle = `${sideColor(s.side)}22`;
  roundRect(ctx, bx, by, bw, bh, 4 * t);
  ctx.fill();
  ctx.restore();
  draw(ctx, badge, bx + 9 * t, baseline - 3 * t, {
    size: badgeSize,
    weight: 500,
    color: sideColor(s.side),
    tracking: 1.5 * t,
  });

  if (s.liquidated) {
    const lx = bx + bw + 10 * t;
    ctx.save();
    ctx.font = `500 ${badgeSize}px ${FACE}`;
    const lw = ctx.measureText("LIQUIDATED").width + 18 * t;
    ctx.fillStyle = AMBER;
    roundRect(ctx, lx, by, lw, bh, 4 * t);
    ctx.fill();
    ctx.restore();
    draw(ctx, "LIQUIDATED", lx + 9 * t, baseline - 3 * t, {
      size: badgeSize,
      weight: 500,
      color: GROUND,
      tracking: 1.5 * t,
    });
  }

  let vx = pad;
  const mark = 28 * t;
  if (s.venueMark) {
    ctx.drawImage(s.venueMark, vx, baseline + 30 * t - mark + 6 * t, mark, mark);
    vx += mark + 10 * t;
  }
  draw(ctx, `${s.venue} · ${wide ? s.wallet : shortAddress(s.wallet, 10)}`, vx, baseline + 30 * t, {
    size: 20 * t,
    color: TX3,
  });

  /* --- right: the number that is moving ------------------------------- */

  draw(ctx, signedUsd(s.total), L.w - pad, baseline, {
    size: 62 * t,
    weight: 700,
    color: toneOf(s.total),
    align: "right",
    tracking: -2 * t,
  });

  const holding =
    s.qty !== 0
      ? `${Math.abs(s.qty) >= 1000 ? Math.round(Math.abs(s.qty)).toLocaleString("en-US") : Math.abs(s.qty).toFixed(2)} @ ${price(s.avgEntry)}`
      : "flat";
  draw(ctx, holding, L.w - pad, baseline + 30 * t, {
    size: 20 * t,
    color: TX3,
    align: "right",
  });
}

/**
 * The stats band, running.
 *
 * The figures move with the cursor — realized and unrealized walking apart as
 * the position comes off is most of what makes a clip feel alive. A band of final
 * figures sitting under a moving chart reads as a caption; these are the position,
 * at this bar.
 */
function paintStats(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const L = s.layout;
  const t = L.statType;
  const r = L.stats;
  const pad = L.pad;
  const p = s.point;

  const cells: { label: string; value: string; color: string }[] = [
    { label: "REALIZED", value: signedUsd(p?.realized ?? 0), color: toneOf(p?.realized ?? 0) },
    { label: "UNREALIZED", value: signedUsd(p?.unrealized ?? 0), color: toneOf(p?.unrealized ?? 0) },
    { label: "NET", value: signedUsd(p?.total ?? 0), color: toneOf(p?.total ?? 0) },
    { label: "FEES", value: `−${usdCompact(p?.fees ?? 0)}`, color: TX2 },
    {
      label: "HOLDING",
      value: p && Math.abs(p.qty) > 1e-9 ? usdCompact(Math.abs(p.qty) * p.price) : "flat",
      color: TX,
    },
    { label: "FILLS", value: String(s.trades), color: TX },
  ];

  const cols = L.cols;
  const rows = Math.ceil(cells.length / cols);
  const cw = (L.w - pad * 2) / cols;
  const rh = r.h / rows;

  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1, 1 * t);
  ctx.beginPath();
  ctx.moveTo(pad, r.y + 0.5);
  ctx.lineTo(L.w - pad, r.y + 0.5);
  ctx.stroke();
  ctx.restore();

  cells.forEach((cell, i) => {
    const cx = pad + (i % cols) * cw;
    const cy = r.y + Math.floor(i / cols) * rh;
    draw(ctx, cell.label, cx, cy + 34 * t, {
      size: 17 * t,
      weight: 700,
      color: TX3,
      tracking: 2 * t,
    });
    draw(ctx, cell.value, cx, cy + 76 * t, {
      size: 38 * t,
      weight: 500,
      color: cell.color,
      tracking: -1 * t,
    });
  });
}

/**
 * Where each label sits, and how wide its text run is.
 *
 * Measured once so the wash can be centred on the label rather than on the frame — the
 * glow is meant to read as coming off the number, and a gradient pinned to the middle
 * of the chart does not.
 */
interface PlacedFill {
  f: PaintFill;
  /** Left edge of the run, and the baseline. */
  x: number;
  y: number;
  width: number;
  k: number;
  head: string;
  tail: string;
}

/**
 * Floating labels for the fills that just landed — the layout.
 *
 * Centred on the chart, large, against whichever edge the layout nominated: the top in
 * a wide frame, where the price action tends to sit low, and the bottom in a tall one,
 * where the chart is deep enough that the action fills it and the bottom is where a
 * phone viewer is already looking.
 */
function placeFills(ctx: CanvasRenderingContext2D, s: FrameState): PlacedFill[] {
  const r = s.layout.chart;
  /** Chart space: what the axis and its clearances are measured in. */
  const k = r.w / DESIGN_W;
  /** Label space: the same, scaled up where the format wants louder labels. */
  const fk = k * s.layout.flashType;
  const mid = r.x + r.w / 2;
  const out: PlacedFill[] = [];

  for (const f of s.fills) {
    if (f.alpha <= 0 && f.wash <= 0) continue;
    const head = f.liquidation
      ? `LIQUIDATED ${usdCompact(f.usd)}`
      : `${usdCompact(f.usd)} ${f.isBuy ? "BUY" : "SELL"}`;
    const tail = ` @ ${price(f.px)}`;

    ctx.save();
    ctx.font = `800 ${26 * fk}px ${FACE}`;
    const headWidth = ctx.measureText(head).width;
    ctx.font = `700 ${17 * fk}px ${FACE}`;
    const tailWidth = ctx.measureText(tail).width;
    ctx.restore();

    /**
     * Shrink to fit rather than run off the edge.
     *
     * A label is one line that cannot wrap, and the widest case — a seven-figure
     * liquidation at a five-figure price — is a good deal longer than the common one.
     * In a 1080-wide frame at the enlarged size that reaches the margins, so the rare
     * long label gives up some size and everything else is unaffected.
     */
    const room = s.layout.w - s.layout.pad * 2;
    const raw = headWidth + tailWidth;
    const fit = raw > room ? room / raw : 1;
    const scale = fk * fit;
    const width = raw * fit;
    // The drift the CSS applies — upward either way, so it reads the same against the
    // bottom edge as against the top.
    const rise = (f.out ? (1 - f.alpha) * 30 : (1 - f.alpha) * -14) * fk;
    /**
     * The edge clearance is in chart space and the stacking is in label space: the gap
     * at the foot exists to clear lightweight-charts' timestamps, which scale with the
     * chart, while the space between two labels has to grow with the labels or a bigger
     * second line would sit on the first.
     */
    const y =
      s.layout.flashAt === "bottom"
        ? r.y + r.h - 76 * k - f.slot * 42 * fk - rise
        : r.y + 60 * k + f.slot * 42 * fk - rise;

    out.push({ f, x: mid - width / 2, y, width, k: scale, head, tail });
  }
  return out;
}

/**
 * The colour a fill throws off as it lands.
 *
 * Centred on the label and painted across the WHOLE frame rather than clipped to the
 * chart, so it washes over every boundary while the number still reads on top of it.
 * Two washes of opposite sign are anchored off-frame at opposite edges: centred on
 * their own labels they would meet in the middle and cancel to a neutral grey, which
 * reads as a white flash rather than as two fills.
 */
function paintWash(ctx: CanvasRenderingContext2D, s: FrameState, placed: PlacedFill[]): void {
  const split =
    placed.some((p) => p.f.wash > 0 && p.f.isBuy) &&
    placed.some((p) => p.f.wash > 0 && !p.f.isBuy);

  for (const p of placed) {
    if (p.f.wash <= 0) continue;
    const tint = p.f.liquidation
      ? "151, 252, 228"
      : p.f.isBuy
        ? "80, 210, 193"
        : "237, 112, 136";
    // Wide enough to surround the text rather than halo it. Split washes are anchored
    // off-frame instead, so they need to reach across it.
    const radius = split ? s.layout.w * 0.7 : Math.max(p.width * 0.95, 320 * p.k);
    // Sell from the left edge, buy from the right, matching the screen.
    const cx = split ? (p.f.isBuy ? s.layout.w : 0) : p.x + p.width / 2;
    const cy = split ? s.layout.h / 2 : p.y - 9 * p.k;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, `rgba(${tint}, ${0.34 * p.f.wash})`);
    glow.addColorStop(0.45, `rgba(${tint}, ${0.13 * p.f.wash})`);
    glow.addColorStop(1, `rgba(${tint}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s.layout.w, s.layout.h);
  }
}

/**
 * The labels themselves. Positions are authored against the on-screen chart and scale
 * with it, which is what keeps an export looking like the replay rather than like a
 * rearrangement of it.
 */
function paintFillLabels(ctx: CanvasRenderingContext2D, placed: PlacedFill[]): void {
  for (const p of placed) {
    if (p.f.alpha <= 0) continue;
    let x = p.x;
    x += draw(ctx, p.head, x, p.y, {
      size: 26 * p.k,
      weight: 800,
      color: p.f.liquidation ? AMBER : p.f.isBuy ? MINT : SIGNAL,
      alpha: p.f.alpha,
    });
    draw(ctx, p.tail, x, p.y, {
      size: 17 * p.k,
      weight: 700,
      color: TX2,
      alpha: p.f.alpha,
    });
  }
}

/**
 * The end card.
 *
 * Fades the whole frame down rather than covering it, so the last state of the chart is
 * still faintly there behind the number. A hard cut to a card reads as the video ending;
 * this reads as the trade settling.
 */
function paintOutro(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const L = s.layout;
  const t = L.type;

  /**
   * Staged card: the veil is down inside the first
   * third, the figures fade in behind it and COUNT UP over the first half, then sit
   * still — which leaves the last frame clean enough to serve as a thumbnail. The
   * chart is dimmed behind the scrim rather than cut away, so the clip reads as
   * settling on its result instead of jumping to a different picture.
   */
  const veil = ease(s.outro / 0.28) * 0.9;
  ctx.save();
  ctx.globalAlpha = veil;
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, L.w, L.h);
  ctx.restore();

  const appear = ease((s.outro - 0.12) / 0.3);
  if (appear <= 0) return;
  const count = ease((s.outro - 0.12) / 0.45);
  // Rises a little as it arrives, the same gesture the fill labels make.
  const lift = (1 - appear) * 26 * t;

  const cx = L.w / 2;
  const cy = L.h / 2;
  const net = s.final.net;

  const kicker = s.liquidated ? "LIQUIDATED" : s.open ? "OPEN" : "CLOSED";
  draw(ctx, kicker, cx, cy - 104 * t - lift, {
    size: 26 * t,
    weight: 400,
    color: s.liquidated ? AMBER : TX3,
    align: "center",
    tracking: 7 * t,
    alpha: appear,
  });

  draw(ctx, signedUsd(net * count), cx, cy + 8 * t - lift, {
    size: 112 * t,
    weight: 700,
    color: toneOf(net),
    align: "center",
    tracking: -4 * t,
    alpha: appear,
  });

  draw(ctx, `${pct(s.final.roe * count)} · ${s.label} ${s.side}`, cx, cy + 58 * t - lift, {
    size: 30 * t,
    color: TX2,
    align: "center",
    alpha: appear,
  });

  /**
   * The row the on-screen card carries, brought to the clip.
   *
   * A net figure alone is a receipt. What somebody sat through to get it is the reason the
   * replay existed, so the peak, the drawdown and the time held finish the story rather
   * than being dropped on the last frame.
   */
  const cells: [string, string, string][] = [
    ["HELD", s.final.held, TX],
    ["PEAK", signedUsd(s.final.peak * count), MINT],
    ["DRAWDOWN", signedUsd(s.final.trough * count), SIGNAL],
    ["FEES", signedUsd(-s.final.fees * count), TX2],
  ];
  const gap = 150 * t;
  const left = cx - ((cells.length - 1) * gap) / 2;
  cells.forEach(([label, value, color], i) => {
    const x = left + i * gap;
    draw(ctx, label, x, cy + 116 * t - lift, {
      size: 17 * t,
      color: TX3,
      align: "center",
      tracking: 2 * t,
      alpha: appear,
    });
    draw(ctx, value, x, cy + 150 * t - lift, {
      size: 28 * t,
      weight: 500,
      color,
      align: "center",
      alpha: appear,
    });
  });

  draw(ctx, "runback", cx, L.h - L.pad - 8 * t, {
    size: 22 * t,
    weight: 500,
    color: TX3,
    align: "center",
    tracking: 5 * t,
    alpha: appear * 0.8,
  });
}
