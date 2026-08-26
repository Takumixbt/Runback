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
      <div className="h-[46px] shrink-0 overflow-hidden border-b border-border">
        <div className="flex h-full items-center gap-7 px-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="hl-skeleton h-[16px] w-[124px] shrink-0" />
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
      className="group h-[46px] shrink-0 overflow-hidden border-b border-border"
      /* Fade both ends into the ground so items enter and leave rather than being cut. */
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
              className="flex shrink-0 items-center gap-2 text-body leading-none"
              aria-hidden={i >= board.marks.length}
            >
              <CoinIcon coin={m.coin} label={m.label} size={18} />
              <span className="text-tx">{m.label}</span>
              <span
                className="tabular-nums transition-colors duration-300"
                style={{ color: lit === "up" ? UP : lit === "down" ? DOWN : "#9aa3a4" }}
              >
                {price(m.px)}
              </span>
              <span className="tabular-nums" style={{ color: m.change >= 0 ? UP : DOWN }}>
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
