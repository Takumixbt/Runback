"use client";

import { useEffect, useRef, useState } from "react";
import { marks, type Mark } from "@/lib/prices";
import { price } from "@/lib/format";

const UP = "#50d2c1";
const DOWN = "#ed7088";

/** Marks go stale fast enough to notice and slow enough that this is plenty. */
const POLL_MS = 15_000;

export function Ticker() {
  const [rows, setRows] = useState<Mark[] | null>(null);
  /** Which marks moved on the last poll, so the change can be flashed rather than swapped. */
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const previous = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let alive = true;

    const pull = async () => {
      try {
        const next = await marks();
        if (!alive || next.length === 0) return;

        const moved: Record<string, "up" | "down"> = {};
        for (const m of next) {
          const was = previous.current.get(m.coin);
          if (was !== undefined && was !== m.px) moved[m.coin] = m.px > was ? "up" : "down";
          previous.current.set(m.coin, m.px);
        }
        setRows(next);
        setFlash(moved);
        // Long enough to register, short enough not to still be lit at the next poll.
        window.setTimeout(() => alive && setFlash({}), 700);
      } catch {
        // A failed poll keeps the last good marks on screen rather than blanking them.
      }
    };

    void pull();
    const id = window.setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!rows) {
    return (
      <div className="relative overflow-hidden border-y border-border py-2.5">
        <div className="flex gap-7 px-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="hl-skeleton h-[13px] w-[92px] shrink-0" />
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
  const track = [...rows, ...rows];

  return (
    <div
      className="group relative overflow-hidden border-y border-border py-2.5"
      /* Fade both ends into the ground so items enter and leave rather than being cut. */
      style={{
        maskImage:
          "linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)",
      }}
    >
      <div className="flex w-max animate-[runback-marquee_64s_linear_infinite] gap-7 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {track.map((m, i) => {
          const lit = flash[m.coin];
          return (
            <div
              key={`${m.coin}-${i}`}
              className="flex shrink-0 items-baseline gap-1.5 text-[11px] leading-none"
              aria-hidden={i >= rows.length}
            >
              <span className={m.equity ? "text-muted" : "text-tx"}>{m.label}</span>
              <span
                className="tabular-nums transition-colors duration-300"
                style={{ color: lit === "up" ? UP : lit === "down" ? DOWN : "#9aa3a4" }}
              >
                {price(m.px)}
              </span>
              <span
                className="tabular-nums"
                style={{ color: m.change >= 0 ? UP : DOWN }}
              >
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
