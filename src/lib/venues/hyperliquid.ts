import * as hl from "@/lib/hl";
import type { VenueAdapter } from "@/lib/adapter";

export const adapter: VenueAdapter = {
  id: "hyperliquid",
  fills: hl.fills,
  candles: hl.candles,
  markets: hl.markets,
  isAddress: hl.isAddress,
};
