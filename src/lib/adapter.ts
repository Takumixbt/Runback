import type { Candle, Fill, Market } from "./hl";
import type { VenueId } from "./venue";

export interface VenueAdapter {
  id: VenueId;
  fills: (
    user: string,
    startTime: number,
    endTime: number,
    opts?: {
      maxPages?: number;
      signal?: AbortSignal;
      onPage?: (soFar: Fill[]) => void;
    },
  ) => Promise<Fill[]>;
  candles: (
    coin: string,
    interval: string,
    startTime: number,
    endTime: number,
    signal?: AbortSignal,
  ) => Promise<Candle[]>;
  markets: (signal?: AbortSignal) => Promise<Map<string, Market>>;
  isAddress: (v: string) => boolean;
}

/**
 * Every venue reports numbers as decimal strings, and any of them can be absent,
 * null or malformed on a single row. `Number("")` is 0 but `Number("n/a")` is NaN,
 * and one NaN reaching a running total silently turns an entire episode's PnL,
 * average entry and drawdown into NaN. Non-finite parses become 0 here so a bad
 * row costs that row rather than the catalogue.
 */
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
export { n };
