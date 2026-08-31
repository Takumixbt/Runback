/**
 * Named wallets. The gallery is a subset; the rest still name a wallet page.
 *
 * Every attribution was looked up. Hyperliquid names come from the community
 * address directory, cross-checked against Lookonchain. Pacifica names are the
 * usernames those accounts set on the public leaderboard. Pictures are X
 * avatars when the owner is publicly known. Where a book has no X-famous
 * trader with a published key, the gallery uses the same identity on that
 * book: same 0x, different tape. Empty cards are dropped, not faked.
 */
import type { VenueId } from "@/lib/venue";

export interface Notable {
  address: string;
  venue: VenueId;
  name: string;
  handle?: string;
  avatar?: string;
  /** Front-page card. Wallet-page naming uses every row. */
  home?: boolean;
}

/** X hands back `_normal`, which is 48px and visibly soft at the size the cards draw. */
const x = (path: string) => `https://pbs.twimg.com/profile_images/${path}_400x400.jpg`;

const MACHI = {
  address: "0x020ca66c30bec2c4fe3861a94e4db4a498a35872",
  name: "Machi Big Brother",
  handle: "machibigbrother",
  avatar: x("1610342982187900928/84eyMoam"),
};
const AGUILA = {
  address: "0x1f250df59a777d61cb8bd043c12970f3afe4f925",
  name: "AguilaTrades",
  handle: "AguilaTrades",
  avatar: x("1826626444937605121/jwa2reEz"),
};
const CBB = {
  address: "0x49e96e255ba418d08e66c35b588e2f2f3766e1d0",
  name: "CBB",
  handle: "Cbb0fe",
  avatar: x("1872626142034739200/EIM6NL_5"),
};
const WYNN = {
  address: "0x5078c2fbea2b2ad61bc840bc023e35fce56bedb6",
  name: "James Wynn",
  handle: "JamesWynnReal",
  avatar: x("2077769907022827520/1CIk6Wch"),
};
const ANSEM = {
  address: "0x2639dc3ab1bc1eb232720be305ce83b57c14405b",
  name: "Ansem",
  handle: "blknoiz06",
  avatar: x("2052070109758226438/xlyPdLmn"),
};
const TATE = {
  address: "0xb78d97390a96a17fd2b58fedbeb3dd876c8f660a",
  name: "Andrew Tate",
  handle: "Cobratate",
  avatar: x("1887763323464146945/5HdM0_7C"),
};
const KANG = {
  address: "0xbb876071a63bc4d9bfcf46b012b4437ea7ff4281",
  name: "Andrew Kang",
  handle: "Rewkang",
  avatar: x("1929878475739107328/80DEpCOa"),
};

export const NOTABLE: Notable[] = [
  { ...WYNN, venue: "hyperliquid", home: true },
  { ...MACHI, venue: "hyperliquid", home: true },
  { ...AGUILA, venue: "hyperliquid", home: true },
  { ...CBB, venue: "hyperliquid", home: true },

  { ...WYNN, venue: "lighter", home: true },
  { ...MACHI, venue: "lighter", home: true },

  { ...AGUILA, venue: "risex", home: true },
  { ...CBB, venue: "risex", home: true },

  {
    venue: "pacifica",
    address: "5RmsTTwkXQgKcTv5BK6CZEjHQMBVLVQVt8po3h5cQabB",
    name: "monogram",
    home: true,
  },
  {
    venue: "pacifica",
    address: "9SL9PHbdixQFyMS5npowKXLdXUWwYReHKuyBrFdFCRxc",
    name: "John Locke",
    home: true,
  },

  { ...ANSEM, venue: "hyperliquid" },
  { ...TATE, venue: "hyperliquid" },
  { ...KANG, venue: "hyperliquid" },
];

export const GALLERY = NOTABLE.filter((n) => n.home);
