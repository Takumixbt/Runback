/**
 * Traders on the front page.
 *
 * Every attribution was looked up: the wallet-to-name mapping comes from the community
 * Hyperliquid address directory, cross-checked against Lookonchain's reporting, and the
 * pictures are the X avatars of those handles. Where a wallet is well known but its owner
 * is not, it keeps the name the chain-watchers gave it and gets no handle.
 */
export interface Notable {
  /** Hyperliquid address, lowercase. */
  address: string;
  /** What to call them. */
  name: string;
  /** X handle without the @, when the owner is publicly known. */
  handle?: string;
  /** Profile picture URL. */
  avatar?: string;
}

/** X hands back `_normal`, which is 48px and visibly soft at the size the cards draw. */
const x = (path: string) => `https://pbs.twimg.com/profile_images/${path}_400x400.jpg`;

export const NOTABLE: Notable[] = [
  {
    /**
     * No handle on purpose.
     *
     * The reporting names @TheWhiteWhaleHL, and that handle now resolves to an account
     * with 82 followers, zero posts, a bio reading "dm me", created October 2025 and
     * carrying X's default egg. It is a squat on a name the real trader stopped using, so
     * linking it would send people to the wrong person and show a grey egg for a picture.
     */
    address: "0xfa6af5f4f7440ce389a1e650991eea45c161e13e",
    name: "The White Whale",
  },
  {
    address: "0x020ca66c30bec2c4fe3861a94e4db4a498a35872",
    name: "Machi Big Brother",
    handle: "machibigbrother",
    avatar: x("1610342982187900928/84eyMoam"),
  },
  {
    address: "0x1f250df59a777d61cb8bd043c12970f3afe4f925",
    name: "AguilaTrades",
    handle: "AguilaTrades",
    avatar: x("1826626444937605121/jwa2reEz"),
  },
  {
    address: "0x49e96e255ba418d08e66c35b588e2f2f3766e1d0",
    name: "CBB",
    handle: "Cbb0fe",
    avatar: x("1872626142034739200/EIM6NL_5"),
  },
  {
    address: "0x5078c2fbea2b2ad61bc840bc023e35fce56bedb6",
    name: "James Wynn",
    handle: "JamesWynnReal",
    avatar: x("2077769907022827520/1CIk6Wch"),
  },
  {
    address: "0x2639dc3ab1bc1eb232720be305ce83b57c14405b",
    name: "Ansem",
    handle: "blknoiz06",
    avatar: x("2052070109758226438/xlyPdLmn"),
  },
];
