import type { VenueAdapter } from "@/lib/adapter";
import type { VenueId } from "@/lib/venue";
import { adapter as hyperliquid } from "./hyperliquid";
import { adapter as lighter } from "./lighter";
import { adapter as risex } from "./risex";
import { adapter as dydx } from "./dydx";
import { adapter as drift } from "./drift";
import { adapter as pacifica } from "./pacifica";
import { adapter as jupiter } from "./jupiter";
import { adapter as txflow } from "./txflow";
import { adapter as polymarket } from "./polymarket";
import { adapter as derive } from "./derive";

const ALL: Record<VenueId, VenueAdapter> = {
  hyperliquid,
  lighter,
  risex,
  dydx,
  drift,
  pacifica,
  jupiter,
  txflow,
  polymarket,
  derive,
};

export function adapter(id: VenueId): VenueAdapter {
  return ALL[id];
}
