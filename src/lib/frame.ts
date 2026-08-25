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
 * Adapted from nathanliow/trickshot (MIT). What changed is the content: a Solana replay has
 * a market cap and a token symbol, a Hyperliquid replay has a side, a leverage-shaped
 * notional, funding, and the possibility of the position being taken off the board.
 */

import { type Layout } from "@/lib/clip";
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

export interface PaintFill {
  isBuy: boolean;
  liquidation: boolean;
  dir: string;
  usd: number;
  px: number;
  /** Which row it occupies, so several at once do not stack on each other. */
  slot: number;
  /** Label opacity, 0..1. */
  alpha: number;
  /** Backdrop opacity on its own curve, and zero once the label starts leaving. */
  wash: number;
}

export interface FrameState {
  layout: Layout;
  /** The chart exactly as drawn, at export resolution. */
  shot: HTMLCanvasElement | null;
  label: string;
  wallet: string;
  side: "LONG" | "SHORT" | "FLIP";
  /** Running totals at this instant of the replay. */
  total: number;
  qty: number;
  avgEntry: number;
  fills: PaintFill[];
  liquidated: boolean;
  /** 0 while the replay runs; 0..1 across the end card. */
  outro: number;
  /** Final figures, for the end card. */
  final: { net: number; realized: number; fees: number; roe: number; peak: number; trough: number };
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
  paintFills(ctx, s);

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

  draw(ctx, wide ? s.wallet : shortAddress(s.wallet, 10), pad, baseline + 30 * t, {
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

function paintStats(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const L = s.layout;
  const t = L.statType;
  const r = L.stats;
  const pad = L.pad;

  const cells: { label: string; value: string; color: string }[] = [
    { label: "NET", value: signedUsd(s.final.net), color: toneOf(s.final.net) },
    { label: "RETURN", value: pct(s.final.roe), color: toneOf(s.final.roe) },
    { label: "REALIZED", value: signedUsd(s.final.realized), color: toneOf(s.final.realized) },
    { label: "FEES", value: `−${usdCompact(s.final.fees)}`, color: TX2 },
    { label: "BEST", value: signedUsd(s.final.peak), color: toneOf(s.final.peak) },
    { label: "WORST", value: signedUsd(s.final.trough), color: toneOf(s.final.trough) },
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
 * Floating labels for the fills that just landed.
 *
 * They sit against whichever edge of the chart the layout nominated: the top in a wide
 * frame, where the price action tends to sit low, and the bottom in a tall one, where the
 * chart is deep enough that the action fills it and the bottom is where a phone viewer is
 * already looking.
 */
function paintFills(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const L = s.layout;
  const t = L.flashType * L.type;
  const size = 26 * t;
  const rowH = size + 26 * t;
  const pad = L.pad;

  for (const f of s.fills) {
    if (f.alpha <= 0) continue;
    const color = f.liquidation ? AMBER : f.isBuy ? MINT : SIGNAL;
    const text = `${f.liquidation ? "LIQUIDATED · " : ""}${f.dir} · ${usdCompact(f.usd)} @ ${price(f.px)}`;

    ctx.save();
    ctx.font = `500 ${size}px ${FACE}`;
    const tw = ctx.measureText(text).width;
    ctx.restore();

    const bw = tw + 28 * t;
    const bh = rowH - 10 * t;
    const x = L.chart.x + pad;
    const y =
      L.flashAt === "top"
        ? L.chart.y + 24 * t + f.slot * rowH
        : L.chart.y + L.chart.h - 24 * t - bh - f.slot * rowH;

    if (f.wash > 0) {
      ctx.save();
      ctx.globalAlpha = f.wash * 0.16;
      ctx.fillStyle = color;
      roundRect(ctx, x, y, bw, bh, 5 * t);
      ctx.fill();
      ctx.restore();
    }

    draw(ctx, text, x + 14 * t, y + bh - 13 * t, {
      size,
      weight: 500,
      color,
      alpha: f.alpha,
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
  const p = ease(s.outro);
  const t = L.type;

  ctx.save();
  ctx.globalAlpha = p * 0.88;
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, L.w, L.h);
  ctx.restore();

  const cx = L.w / 2;
  const cy = L.h / 2;
  const net = s.final.net;

  draw(ctx, s.liquidated ? "LIQUIDATED" : net >= 0 ? "CLOSED" : "CLOSED", cx, cy - 96 * t, {
    size: 26 * t,
    weight: 400,
    color: s.liquidated ? AMBER : TX3,
    align: "center",
    tracking: 6 * t,
    alpha: p,
  });

  draw(ctx, signedUsd(net), cx, cy + 20 * t, {
    size: 118 * t,
    weight: 700,
    color: toneOf(net),
    align: "center",
    tracking: -4 * t,
    alpha: p,
  });

  draw(ctx, `${pct(s.final.roe)} · ${s.label} ${s.side}`, cx, cy + 74 * t, {
    size: 30 * t,
    color: TX2,
    align: "center",
    alpha: p,
  });

  draw(ctx, "runback", cx, L.h - L.pad - 8 * t, {
    size: 22 * t,
    weight: 500,
    color: TX3,
    align: "center",
    tracking: 5 * t,
    alpha: p * 0.8,
  });
}
