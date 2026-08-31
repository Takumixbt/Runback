"use client";

import { useMarket } from "./MarketProvider";
import { CoinIcon } from "./CoinIcon";
import { price } from "@/lib/format";

const UP = "#50d2c1";
const DOWN = "#ed7088";

export function Ticker() {
  const { board, flash } = useMarket();

  if (!board) {
    return (
      <div className="h-11 shrink-0 overflow-hidden border-b border-white/[0.06]">
        <div className="flex h-full items-center gap-7 px-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="hl-skeleton h-3.5 w-24 shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  /**
   * The list twice, and the track translated by exactly half its width.
   *
   * A marquee that scrolls one copy has to jump back at the end, which reads as a stutter.
   * Two identical copies mean the halfway point is pixel-identical to the start, so the
   * reset is invisible and the motion is continuous.
   */
  const track = [...board.marks, ...board.marks];

  return (
    <div
      className="group h-11 shrink-0 overflow-hidden border-b border-white/[0.06]"
      style={{
        maskImage:
          "linear-gradient(to right, transparent, black 40px, black calc(100% - 40px), transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 40px, black calc(100% - 40px), transparent)",
      }}
    >
      <div className="flex h-full w-max animate-[runback-marquee_78s_linear_infinite] items-center gap-8 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {track.map((m, i) => {
          const lit = flash[m.coin];
          return (
            <div
              key={`${m.coin}-${i}`}
              className="flex shrink-0 items-center gap-2 text-mini leading-none"
              aria-hidden={i >= board.marks.length}
            >
              <CoinIcon coin={m.coin} label={m.label} size={15} />
              <span className="text-muted">{m.label}</span>
              <span
                className="transition-colors duration-300"
                style={{ color: lit === "up" ? UP : lit === "down" ? DOWN : "#f6fefd" }}
              >
                {price(m.px)}
              </span>
              <span style={{ color: m.change >= 0 ? UP : DOWN }}>
                {m.change >= 0 ? "+" : "−"}
                {(Math.abs(m.change) * 100).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
