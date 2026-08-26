/**
 * Traders on the front page.
 *
 * Hand-curated, and deliberately not inferred. Attaching a name to an address is a claim
 * about a person, and there is no endpoint that makes it true: the addresses behind the
 * well-known Hyperliquid names are reported second-hand and change hands. So nothing here
 * is guessed. An entry exists because somebody put it here.
 *
 * `avatar` is optional and takes any image URL. Leave it out and the card draws a
 * deterministic gradient from the address instead, which is stable per wallet and needs no
 * network. Everything else on the card, the best position, the worst one, the numbers, is
 * read live from the chain, so nothing here can go stale except the name.
 */
export interface Notable {
  /** Hyperliquid address, lowercase. */
  address: string;
  /** What to call them. */
  name: string;
  /** One short line. Optional. */
  note?: string;
  /** Profile picture URL. Optional. */
  avatar?: string;
}

export const NOTABLE: Notable[] = [
  {
    address: "0x020ca66c30bec2c4fe3861a94e4db4a498a35872",
    name: "Whale 020c",
    note: "Size on HYPE and BTC",
  },
  {
    address: "0x49e96e255ba418d08e66c35b588e2f2f3766e1d0",
    name: "Desk 49e9",
    note: "Makes markets across HIP-3 equities",
  },
];
