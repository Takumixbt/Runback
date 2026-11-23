import { CoinIcon } from "./CoinIcon";
import { VenueMark } from "./VenueMark";

/**
 * The stage: one replay, mid-play.
 *
 * The product's whole story in a single drawing — candles stepping up, fills
 * landing, the equity line drawing itself — so the hero can say "watch it
 * trade" and immediately show what that looks like. Hand-set data, pure SVG,
 * no client JS: identical on every render.
 *
 * The craft is in the chrome, not the decoration: a right-hand price rail with
 * the last print tagged on it, a volume strip under the candles, a hairline
 * that closes the price well before the equity band, a dot grain over the
 * screen, and one soft vignette so the chart sits *inside* something. The
 * load is a single orchestrated sequence; nothing loops.
 */

/** [open, high, low, close] in dollars. */
const CANDLES: [number, number, number, number][] = [
  [3080, 3096, 3062, 3090],
  [3090, 3118, 3078, 3108],
  [3108, 3124, 3088, 3096],
  [3096, 3114, 3070, 3080],
  [3080, 3104, 3072, 3098],
  [3098, 3146, 3090, 3136],
  [3136, 3168, 3122, 3158],
  [3158, 3176, 3128, 3136],
  [3136, 3164, 3122, 3156],
  [3156, 3204, 3148, 3196],
  [3196, 3222, 3166, 3174],
  [3174, 3218, 3164, 3208],
  [3208, 3260, 3200, 3248],
  [3248, 3306, 3236, 3294],
  [3294, 3318, 3252, 3264],
  [3264, 3326, 3256, 3316],
  [3316, 3390, 3304, 3376],
  [3376, 3432, 3352, 3416],
  [3416, 3460, 3386, 3402],
  [3402, 3486, 3392, 3464],
  [3464, 3572, 3450, 3548],
  [3548, 3702, 3530, 3690],
];

/** Volume in arbitrary units, deterministic — texture, not information. */
const VOLUME = [0.5, 0.7, 0.4, 0.55, 0.35, 0.8, 0.6, 0.45, 0.5, 0.9, 0.55, 0.65, 0.75, 0.6, 0.5, 0.7, 0.85, 0.6, 0.55, 0.75, 0.95, 0.8];

const X0 = 24;
const STEP = 20;
const BODY = 9;
const PRICE_MIN = 3060;
const PRICE_MAX = 3716;
const Y_TOP = 64;
const Y_BOTTOM = 200;
const VOLUME_BASE = 218;
const VOLUME_MAX = 12;
const RULE_Y = 228;
const EQ_TOP = 244;
const EQ_BOTTOM = 298;
const TIME_Y = 324;
const AXIS_X = 470;
const WIDTH = 560;

const x = (i: number) => X0 + i * STEP;
const y = (p: number) =>
  Y_TOP + (PRICE_MAX - p) * ((Y_BOTTOM - Y_TOP) / (PRICE_MAX - PRICE_MIN));

const lastClose = CANDLES[CANDLES.length - 1]![3];
const lastX = x(CANDLES.length - 1);

const EQUITY = CANDLES.map(([, , , c], i) => c - 3080 + i * 3.5);
const EQ_MIN = Math.min(...EQUITY);
const EQ_MAX = Math.max(...EQUITY);
const eqY = (e: number) => EQ_BOTTOM - ((e - EQ_MIN) / (EQ_MAX - EQ_MIN)) * (EQ_BOTTOM - EQ_TOP);

/** Catmull-Rom to cubic Bezier: an equity curve, not a polyline. */
function smooth(points: { x: number; y: number }[]): string {
  const f = (v: number) => v.toFixed(1);
  let d = `M ${f(points[0]!.x)} ${f(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? points[i + 1]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

const EQ_PTS = EQUITY.map((e, i) => ({ x: x(i), y: eqY(e) }));
const EQ_LINE = smooth(EQ_PTS);
const EQ_AREA = `${EQ_LINE} L ${lastX} ${EQ_BOTTOM} L ${x(0)} ${EQ_BOTTOM} Z`;

/** Fills land on the candles that keep the story: entry, add, add, last push. */
const MARKERS = [4, 10, 16, 20];

const LEVELS = [3700, 3500, 3300, 3100];
const TIMES: [number, string][] = [
  [2, "11:00"],
  [8, "14:00"],
  [14, "17:00"],
  [20, "20:00"],
];

export function ReplayStage() {
  const lastEq = EQ_PTS[EQ_PTS.length - 1]!;
  const chipY = Math.min(Math.max(lastEq.y - 12, EQ_TOP - 10), EQ_BOTTOM - 12);

  return (
    <div className="rb-stage rb-stage-in relative overflow-hidden p-4" aria-hidden>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <CoinIcon coin="ETH" label="ETH" size={20} />
          <span className="text-body font-semibold tracking-tight text-title">ETH-USD</span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-[3px] text-micro leading-none text-muted">
            4h
          </span>
        </span>
        <span className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-2.5 pr-1.5 text-mini leading-none text-muted">
          Hyperliquid
          <VenueMark id="hyperliquid" size={16} />
        </span>
      </div>

      <div className="rb-stage-screen mt-3 overflow-hidden rounded-xl px-1.5 pb-1 pt-2">
        <svg viewBox={`0 0 ${WIDTH} 344`} className="w-full" role="presentation">
          <defs>
            <linearGradient id="rb-eq-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#50d2c1" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#50d2c1" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="rb-last-glow">
              <stop offset="0%" stopColor="#97fce4" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#97fce4" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="rb-vignette" cx="50%" cy="42%" r="72%">
              <stop offset="55%" stopColor="#000" stopOpacity="0" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.2" />
            </radialGradient>
            <pattern id="rb-dots" width="12" height="12" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.6" fill="#ffffff" opacity="0.05" />
            </pattern>
          </defs>

          {/* Price rail: levels, labels, and the last print tagged on the axis. */}
          {LEVELS.map((lv) => (
            <g key={lv}>
              <line
                x1="14"
                x2={AXIS_X - 10}
                y1={y(lv)}
                y2={y(lv)}
                stroke="#ffffff"
                strokeOpacity="0.045"
                strokeDasharray="2 6"
              />
              <text
                x={AXIS_X}
                y={y(lv) + 3}
                fill="#9aa3a4"
                fillOpacity="0.55"
                fontSize="9.5"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {lv.toLocaleString("en-US")}
              </text>
            </g>
          ))}

          {/* Time rail. */}
          {TIMES.map(([i, t]) => (
            <text
              key={t}
              x={x(i)}
              y={TIME_Y}
              fill="#9aa3a4"
              fillOpacity="0.4"
              fontSize="9.5"
              textAnchor="middle"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t}
            </text>
          ))}

          {/* Volume strip: a quiet bed under the candles. */}
          {VOLUME.map((v, i) => {
            const up = CANDLES[i]![3] >= CANDLES[i]![0];
            const h = 2 + v * VOLUME_MAX;
            return (
              <rect
                key={i}
                x={x(i) - 3}
                y={VOLUME_BASE - h}
                width="6"
                height={h}
                rx="1"
                fill={up ? "#50d2c1" : "#ed7088"}
                fillOpacity="0.16"
                className="rb-candle"
                style={{ animationDelay: `${i * 35}ms` }}
              />
            );
          })}

          {CANDLES.map(([o, h, l, c], i) => {
            const up = c >= o;
            const color = up ? "#50d2c1" : "#ed7088";
            const top = Math.min(y(o), y(c));
            const height = Math.max(Math.abs(y(o) - y(c)), 1.5);
            return (
              <g key={i} className="rb-candle" style={{ animationDelay: `${i * 45}ms` }}>
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={y(h)}
                  y2={y(l)}
                  stroke={color}
                  strokeWidth="1.4"
                  strokeOpacity="0.65"
                />
                <rect
                  x={x(i) - BODY / 2}
                  y={top}
                  width={BODY}
                  height={height}
                  rx="1.5"
                  fill={up ? color : "#0b151a"}
                  stroke={color}
                  strokeWidth="1.5"
                  fillOpacity={up ? 0.9 : 1}
                />
              </g>
            );
          })}

          {/* The last print glows — it is the moment the replay is paused on. */}
          <circle cx={x(CANDLES.length - 1)} cy={y(lastClose)} r="16" fill="url(#rb-last-glow)" className="rb-stage-fade" />
          <line
            x1="14"
            x2={AXIS_X - 12}
            y1={y(lastClose)}
            y2={y(lastClose)}
            stroke="#97fce4"
            strokeOpacity="0.28"
            strokeDasharray="2 5"
            className="rb-stage-fade"
          />
          <g className="rb-stage-fade">
            <rect x={AXIS_X - 12} y={y(lastClose) - 9} width="72" height="18" rx="9" fill="#97fce4" />
            <text
              x={AXIS_X + 24}
              y={y(lastClose) + 3.5}
              fill="#04060c"
              fontSize="10"
              fontWeight="600"
              textAnchor="middle"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {lastClose.toLocaleString("en-US", { minimumFractionDigits: 1 })}
            </text>
          </g>

          {/* Fill arrows, with a faint halo so they sit above the ink. */}
          {MARKERS.map((i, k) => {
            const topY = y(CANDLES[i]![1]) - 12;
            return (
              <g key={i} className="rb-stage-marker" style={{ animationDelay: `${1250 + k * 240}ms` }}>
                <path
                  d={`M ${x(i)} ${topY - 5} l 5.5 8.5 h -11 z`}
                  fill="#97fce4"
                  fillOpacity="0.16"
                  transform="translate(0 2)"
                />
                <path d={`M ${x(i)} ${topY} l 4.5 7 h -9 z`} fill="#97fce4" />
              </g>
            );
          })}

          {/* The close of the price well, then the equity band. */}
          <line x1="14" x2={AXIS_X - 10} y1={RULE_Y} y2={RULE_Y} stroke="#ffffff" strokeOpacity="0.06" />
          <text x="14" y={RULE_Y + 16} fill="#9aa3a4" fillOpacity="0.4" fontSize="9" letterSpacing="0.08em">
            PNL
          </text>

          <path d={EQ_AREA} fill="url(#rb-eq-fill)" className="rb-stage-fade" />
          <path
            d={EQ_LINE}
            fill="none"
            stroke="#97fce4"
            strokeWidth="2.2"
            strokeLinecap="round"
            pathLength={1}
            className="rb-eq-line"
          />
          <g className="rb-stage-fade">
            <circle cx={lastEq.x} cy={lastEq.y} r="7" fill="#97fce4" fillOpacity="0.18" />
            <circle cx={lastEq.x} cy={lastEq.y} r="3" fill="#97fce4" />
          </g>

          {/* The net chip rides the end of the line, on a connector. */}
          <g className="rb-stage-badge">
            <line x1={lastEq.x + 3} x2={lastEq.x + 14} y1={lastEq.y} y2={chipY + 12} stroke="#97fce4" strokeOpacity="0.3" />
            <rect x={lastEq.x + 12} y={chipY} width="102" height="24" rx="12" fill="#0b151a" stroke="#97fce4" strokeOpacity="0.3" />
            <text x={lastEq.x + 24} y={chipY + 16} fill="#9aa3a4" fillOpacity="0.7" fontSize="9.5" letterSpacing="0.06em">
              NET
            </text>
            <text
              x={lastEq.x + 48}
              y={chipY + 16}
              fill="#97fce4"
              fontSize="12"
              fontWeight="600"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              +$41,680
            </text>
          </g>

          {/* Grain and vignette last: the screen is glass with texture in it. */}
          <rect x="0" y="48" width={WIDTH} height="262" fill="url(#rb-dots)" />
          <rect x="0" y="48" width={WIDTH} height="262" fill="url(#rb-vignette)" />
        </svg>
      </div>

      <div className="mt-3 flex items-center justify-between px-1 text-micro text-faint">
        <span className="flex items-center gap-3.5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-[10px] rounded-full bg-mint" />
            PnL
          </span>
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 10 10" className="h-[8px] w-[8px]" aria-hidden>
              <path d="M5 1 9 8H1z" fill="#97fce4" />
            </svg>
            Fill
          </span>
        </span>
        <span className="tabular-nums">replay · 1×</span>
      </div>
    </div>
  );
}
