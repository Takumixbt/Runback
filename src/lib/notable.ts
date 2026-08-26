/**
 * Traders on the front page.
 *
 * Every attribution here was looked up, not inferred. The wallet-to-name mapping comes
 * from the community Hyperliquid address directory at cryexc.josedonato.com/hl-addresses,
 * cross-checked against Lookonchain's reporting and each account's own posts; the pictures
 * are the X avatars of the handles listed. Where a wallet is well known but its owner is
 * not, it keeps the name the chain-watchers gave it and gets no handle, because inventing
 * one would be a claim about a person.
 *
 * `avatar` takes any image URL. Leave it out and the card draws a deterministic gradient
 * from the address instead. Everything else on the card, the best position, the worst one,
 * the numbers, is read live from the chain, so nothing here can go stale except the name.
 */
export interface Notable {
  /** Hyperliquid address, lowercase. */
  address: string;
  /** What to call them. */
  name: string;
  /** X handle without the @, when the owner is publicly known. */
  handle?: string;
  /** One short line. */
  note?: string;
  /** Profile picture URL. */
  avatar?: string;
}

/**
 * X serves avatars at several sizes and the API hands back `_normal`, which is 48px and
 * visibly soft at the size these cards draw them.
 */
const x = (path: string) => `https://pbs.twimg.com/profile_images/${path}_400x400.jpg`;

export const NOTABLE: Notable[] = [
  {
    address: "0x2ea18c23f72a4b6172c55b411823cdc5335923f4",
    name: "ETH Insider Whale",
    note: "The ETH long everyone watched",
  },
  {
    address: "0xfa6af5f4f7440ce389a1e650991eea45c161e13e",
    name: "The White Whale",
    note: "Size on ETH, rarely wrong",
  },
  {
    address: "0x020ca66c30bec2c4fe3861a94e4db4a498a35872",
    name: "Machi Big Brother",
    handle: "machibigbrother",
    note: "Perma-long, liquidated more than anyone",
    avatar: x("1610342982187900928/84eyMoam"),
  },
  {
    address: "0x1f250df59a777d61cb8bd043c12970f3afe4f925",
    name: "AguilaTrades",
    handle: "AguilaTrades",
    note: "Enormous swings in both directions",
    avatar: x("1826626444937605121/jwa2reEz"),
  },
  {
    address: "0x49e96e255ba418d08e66c35b588e2f2f3766e1d0",
    name: "CBB",
    handle: "Cbb0fe",
    note: "Trades the HIP-3 equity perps all day",
    avatar: x("1872626142034739200/EIM6NL_5"),
  },
  {
    address: "0x5078c2fbea2b2ad61bc840bc023e35fce56bedb6",
    name: "James Wynn",
    handle: "JamesWynnReal",
    note: "$4M to $87M to zero, then back",
    avatar: x("2077769907022827520/1CIk6Wch"),
  },
  {
    address: "0x2639dc3ab1bc1eb232720be305ce83b57c14405b",
    name: "Ansem",
    handle: "blknoiz06",
    note: "Mostly spot, occasionally leveraged",
    avatar: x("2052070109758226438/xlyPdLmn"),
  },
];
