/**
 * The books Runback can replay, and how a pasted string picks one.
 *
 * Hyperliquid is still the native fit: public fills with startPosition, dir and
 * closedPnl, CORS *, 0x addresses. Everything else is mapped onto that shape.
 * A venue is in this list only if a visitor can paste an identity and get history
 * without signing or an API key.
 *
 * The URL is `/w/{venue}/{wallet}` so a clip stays on the book it was taken from.
 * `/w/0x…` still works: it redirects to Hyperliquid, which is what every existing
 * link meant.
 */

export type VenueId =
  | "hyperliquid"
  | "lighter"
  | "risex"
  | "dydx"
  | "drift"
  | "pacifica"
  | "jupiter";

export type AddressKind = "evm" | "solana" | "dydx";

export interface Venue {
  id: VenueId;
  name: string;
  short: string;
  chain: string;
  kind: AddressKind;
  /** Public explorer for this identity, or null when there is not a useful one. */
  explorer: (wallet: string) => string | null;
  placeholder: string;
}

export const VENUES: readonly Venue[] = [
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    short: "HL",
    chain: "Hyperliquid L1",
    kind: "evm",
    explorer: (w) => `https://app.hyperliquid.xyz/explorer/address/${w}`,
    placeholder: "0x…",
  },
  {
    id: "lighter",
    name: "Lighter",
    short: "LIT",
    chain: "Lighter L2",
    kind: "evm",
    explorer: (w) => `https://app.lighter.xyz/explore/account/${w}`,
    placeholder: "0x…",
  },
  {
    id: "risex",
    name: "RiseX",
    short: "RISE",
    chain: "RISE Chain",
    kind: "evm",
    explorer: (w) => `https://explorer.risechain.com/address/${w}`,
    placeholder: "0x…",
  },
  {
    id: "drift",
    name: "Drift",
    short: "DRIFT",
    chain: "Solana",
    kind: "solana",
    explorer: (w) => `https://app.drift.trade/overview?authority=${w}`,
    placeholder: "Solana address",
  },
  {
    id: "pacifica",
    name: "Pacifica",
    short: "PAC",
    chain: "Solana",
    kind: "solana",
    explorer: (w) => `https://app.pacifica.fi/?account=${w}`,
    placeholder: "Solana address",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    short: "JUP",
    chain: "Solana",
    kind: "solana",
    explorer: (w) => `https://solscan.io/account/${w}`,
    placeholder: "Solana address",
  },
  {
    id: "dydx",
    name: "dYdX",
    short: "DYDX",
    chain: "dYdX Chain",
    kind: "dydx",
    explorer: (w) => `https://www.dydx.xyz/portfolio?address=${w}`,
    placeholder: "dydx1…",
  },
];

export const REFERRAL: Partial<Record<VenueId, string>> = {
  hyperliquid: "https://app.hyperliquid.xyz/join/TAKUMI",
  lighter: "https://app.lighter.xyz/?referral=TAKUMI&source=none",
};

/** Official marks, filed under /public/venues from each book's own icon. */
export const VENUE_MARK: Record<VenueId, string> = {
  hyperliquid: "/venues/hyperliquid.png",
  lighter: "/venues/lighter.png",
  risex: "/venues/risex.svg",
  drift: "/venues/drift.png",
  pacifica: "/venues/pacifica.png",
  jupiter: "/venues/jupiter.png",
  dydx: "/venues/dydx.png",
};

const VENUE_IDS: VenueId[] = VENUES.map((v) => v.id);

export function isVenueId(v: string): v is VenueId {
  return (VENUE_IDS as string[]).includes(v);
}

export function venue(id: string): Venue | null {
  return VENUES.find((v) => v.id === id) ?? null;
}

export function venuesFor(kind: AddressKind): Venue[] {
  return VENUES.filter((v) => v.kind === kind);
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const DYDX = /^dydx1[a-z0-9]{38,}$/;
/** Base58, no 0, I, O, l. Solana pubkeys are 32–44 chars. */
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function kindOfAddress(raw: string): AddressKind | null {
  const v = raw.trim();
  if (EVM.test(v)) return "evm";
  if (DYDX.test(v.toLowerCase())) return "dydx";
  if (SOLANA.test(v) && !v.startsWith("0x")) return "solana";
  return null;
}

export interface Account {
  kind: AddressKind;
  /** Stored and fetched form. EVM and dYdX are lowercased; Solana is not. */
  canonical: string;
  defaultVenue: VenueId;
}

export function parseAccount(raw: string): Account | null {
  const v = raw.trim();
  const kind = kindOfAddress(v);
  if (!kind) return null;
  if (kind === "evm") {
    return { kind, canonical: v.toLowerCase(), defaultVenue: "hyperliquid" };
  }
  if (kind === "dydx") {
    return { kind, canonical: v.toLowerCase(), defaultVenue: "dydx" };
  }
  return { kind, canonical: v, defaultVenue: "drift" };
}

export function walletPath(id: VenueId, wallet: string, position?: string): string {
  const base = `/w/${id}/${encodeURIComponent(wallet)}`;
  return position ? `${base}?p=${encodeURIComponent(position)}` : base;
}

export function venueFits(id: VenueId, wallet: string): boolean {
  const v = venue(id);
  const kind = kindOfAddress(wallet);
  return !!v && kind === v.kind;
}

/** Solana keys are case-sensitive. EVM and dYdX are not. */
export function sameIdentity(a: string, b: string): boolean {
  if (kindOfAddress(a) === "solana" || kindOfAddress(b) === "solana") return a === b;
  return a.toLowerCase() === b.toLowerCase();
}
