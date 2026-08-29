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

const n = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
export { n };
