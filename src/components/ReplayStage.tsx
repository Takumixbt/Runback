import { CoinIcon } from "./CoinIcon";
import { VenueMark } from "./VenueMark";

/**
 * The stage: one replay, mid-play.
 *
 * This is the product's whole story in a single drawing — candles stepping up,
 * fill arrows landing, the mint equity line drawing itself — so the hero can
 * say "watch it trade" and immediately show what that looks like. Pure SVG and
 * hand-set numbers: no chart library, no client JS, identical on every render.
 * The load is one orchestrated sequence; nothing loops, because a hero that
 * fidgets forever is noise, not motion.
 */

/** o/h/l/c in arbitrary price units; the chart maps them into the card. */
const CANDLES: [number, number, number, number][] = [
  [20, 26, 16, 24],
  [24, 30, 20, 27],
  [27, 31, 22, 24],
  [24, 28, 19, 23],
  [23, 27, 18, 22],
  [22, 30, 20, 28],
  [28, 34, 25, 32],
  [32, 36, 27, 29],
  [29, 34, 26, 33],
  [33, 40, 31, 38],
  [38, 42, 33, 35],
  [35, 41, 32, 40],
  [40, 47, 37, 45],
  [45, 51, 42, 48],
  [48, 52, 43, 46],
  [46, 54, 44, 52],
  [52, 60, 50, 58],
  [58, 68, 56, 66],
];

const X0 = 30;
const STEP = 26;
const BODY = 10;
const TOP = 100; // price 68 sits here
const SCALE = 2.0; // px per price unit
const EQUITY_BOTTOM = 288;
const EQUITY_HEIGHT = 54;
/** The rule that separates price from equity, clear of every wick (lowest is y=204). */
const RULE_Y = 220;

const y = (v: number) => TOP + (68 - v) * SCALE;
const x = (i: number) => X0 + i * STEP + BODY / 2;

/** Running equity: the close, riding a trend that starts modest and compounds. */
const EQUITY = CANDLES.map(([, , , c], i) => c + i * 1.35);
const EQ_MIN = Math.min(...EQUITY);
const EQ_MAX = Math.max(...EQUITY);
const eqY = (e: number) => EQUITY_BOTTOM - ((e - EQ_MIN) / (EQ_MAX - EQ_MIN)) * EQUITY_HEIGHT;

const EQ_POINTS = EQUITY.map((e, i) => `${x(i).toFixed(1)},${eqY(e).toFixed(1)}`).join(" ");
const EQ_AREA = `M ${x(0).toFixed(1)},${EQUITY_BOTTOM} L ${EQ_POINTS.split(" ").join(" L ")} L ${x(
  EQUITY.length - 1,
).toFixed(1)},${EQUITY_BOTTOM} Z`;

/** Fills land on the candles that keep the story: entry, add, final push. */
const MARKERS = [5, 11, 16];

export function ReplayStage() {
  return (
    <div className="rb-card relative overflow-hidden p-4" aria-hidden>
      <div className="relative rounded-xl bg-ground/60 px-3 pb-2 pt-3 ring-1 ring-white/[0.04]">
        <div className="flex items-center justify-between gap-3 px-1 text-mini">
          <span className="flex items-center gap-2">
            <CoinIcon coin="ETH" label="ETH" size={16} />
            <span className="font-medium text-tx">ETH-USD</span>
            <span className="text-faint">4h</span>
          </span>
          <span className="flex items-center gap-2 text-faint">
            Hyperliquid
            <VenueMark id="hyperliquid" size={16} />
          </span>
        </div>

        <svg viewBox="0 0 520 300" className="mt-1 w-full" role="presentation">
          <defs>
            <linearGradient id="rb-eq-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#50d2c1" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#50d2c1" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Quiet rules, the way the replay chart is ruled. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="18"
              x2="502"
              y1={TOP + f * 210}
              y2={TOP + f * 210}
              stroke="#ffffff"
              strokeOpacity="0.035"
              strokeDasharray="3 6"
            />
          ))}

          {/* PnL floor: a hairline separating price from equity. */}
          <line
            x1="18"
            x2="502"
            y1={RULE_Y}
            y2={RULE_Y}
            stroke="#ffffff"
            strokeOpacity="0.05"
          />

          {CANDLES.map(([o, h, l, c], i) => {
            const up = c >= o;
            const color = up ? "#50d2c1" : "#ed7088";
            const top = Math.min(y(o), y(c));
            const height = Math.max(Math.abs(y(o) - y(c)), 1.5);
            return (
              <g
                key={i}
                className="rb-candle"
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={y(h)}
                  y2={y(l)}
                  stroke={color}
                  strokeWidth="1.5"
                  strokeOpacity="0.7"
                />
                <rect
                  x={x(i) - BODY / 2}
                  y={top}
                  width={BODY}
                  height={height}
                  rx="1.5"
                  fill={up ? color : "#0f1a1e"}
                  stroke={color}
                  strokeWidth="1.5"
                  fillOpacity={up ? 0.85 : 1}
                />
              </g>
            );
          })}

          <path d={EQ_AREA} fill="url(#rb-eq-fill)" className="rb-stage-fade" />
          <polyline
            points={EQ_POINTS}
            fill="none"
            stroke="#97fce4"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="rb-eq-line"
          />

          {MARKERS.map((i, k) => (
            <path
              key={i}
              d={`M ${x(i)} ${y(CANDLES[i]![3]) - 14} l 5 8 h -10 z`}
              fill="#97fce4"
              className="rb-stage-marker"
              style={{ animationDelay: `${900 + k * 260}ms` }}
            />
          ))}
        </svg>

        <div className="pointer-events-none absolute bottom-4 right-5 flex items-baseline gap-2 rounded-full border border-mint-soft/25 bg-raise/90 px-3.5 py-1.5 shadow-[0_10px_30px_-12px_#000] rb-stage-badge">
          <span className="text-micro tracking-[0.08em] text-faint">NET</span>
          <span className="text-body font-semibold text-mint">+$41,680</span>
        </div>
      </div>
    </div>
  );
}
