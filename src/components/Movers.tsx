"use client";

import { useMarket } from "./MarketProvider";
import { CoinIcon } from "./CoinIcon";
import { Panel } from "./Panel";
import { price, usdCompact } from "@/lib/format";

const UP = "#50d2c1";
const DOWN = "#ed7088";

/**
 * The day's biggest moves, filtered to markets with real turnover.
 *
 * Live, from the same poll the ticker uses. It is here because the front page needed
 * something true on it rather than something explanatory, and a mover list is the one
 * thing on a trading site that is worth looking at before you have typed anything.
 */
export function Movers() {
  const { board, flash } = useMarket();

  return (
    <Panel
      label="24H MOVERS"
      aside={
        board ? (
          <span className="text-faint">
            {board.markets} markets · {usdCompact(board.dayVolume)} volume
          </span>
        ) : null
      }
      flush
    >
      {!board ? (
        <div className="flex flex-col">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-b border-divider px-3 py-2.5 last:border-b-0">
              <div className="hl-skeleton h-[14px] w-full" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col">
          {board.movers.map((m) => {
            const lit = flash[m.coin];
            return (
              <li
                key={m.coin}
                className="flex items-center gap-2.5 border-b border-divider px-3 py-2.5 text-[12px] last:border-b-0"
              >
                <CoinIcon coin={m.coin} label={m.label} size={16} />
                <span className="min-w-0 flex-1 truncate text-tx">{m.label}</span>
                {m.equity && (
                  <span className="shrink-0 text-[9px] tracking-[0.08em] text-faint">
                    EQUITY
                  </span>
                )}
                <span
                  className="shrink-0 tabular-nums transition-colors duration-300"
                  style={{ color: lit === "up" ? UP : lit === "down" ? DOWN : "#9aa3a4" }}
                >
                  {price(m.px)}
                </span>
                <span
                  className="w-[62px] shrink-0 text-right tabular-nums"
                  style={{ color: m.change >= 0 ? UP : DOWN }}
                >
                  {m.change >= 0 ? "+" : "−"}
                  {(Math.abs(m.change) * 100).toFixed(2)}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
