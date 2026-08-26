"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { board, type Board, type Mark } from "@/lib/prices";

/**
 * One poll of the market, shared by everything that shows a price.
 *
 * The ticker, the summary strip and the movers list all want the same two calls. Left to
 * fetch for themselves they would each run their own interval, which is three times the
 * request rate for identical data and three lists that disagree with each other for a few
 * seconds after every tick. One poll, one source, one truth on screen.
 */

const POLL_MS = 15_000;

interface MarketState {
  board: Board | null;
  /** Which marks moved on the last tick, so a change can be flashed rather than swapped. */
  flash: Record<string, "up" | "down">;
}

const Ctx = createContext<MarketState>({ board: null, flash: {} });

export function useMarket(): MarketState {
  return useContext(Ctx);
}

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MarketState>({ board: null, flash: {} });
  const previous = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let alive = true;
    let clear = 0;

    const pull = async () => {
      try {
        const next = await board();
        if (!alive || next.marks.length === 0) return;

        const moved: Record<string, "up" | "down"> = {};
        for (const m of [...next.marks, ...next.movers]) {
          const was = previous.current.get(m.coin);
          if (was !== undefined && was !== m.px) moved[m.coin] = m.px > was ? "up" : "down";
          previous.current.set(m.coin, m.px);
        }

        setState({ board: next, flash: moved });
        window.clearTimeout(clear);
        // Long enough to register, short enough not to still be lit at the next poll.
        clear = window.setTimeout(() => {
          if (alive) setState((s) => ({ ...s, flash: {} }));
        }, 700);
      } catch {
        // A failed poll keeps the last good marks on screen rather than blanking them.
      }
    };

    void pull();
    const id = window.setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(clear);
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export type { Mark };
