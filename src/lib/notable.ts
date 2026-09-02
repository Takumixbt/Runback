/**
 * Named wallets. The gallery is a subset; the rest still name a wallet page.
 *
 * Ten on the front page, grouped by book: four Hyperliquid, two Lighter, two
 * Pacifica, two RiseX. Every row is from a public source on that book. Hyperliquid
 * names come from the community address directory. Pacifica names are usernames
 * those accounts set on Pacifica's leaderboard. Lighter names are operators who
 * published a public pool on that book. RiseX does not publish trader names; those
 * two cards are the all-time PnL leaders on RiseX's own board, shown as truncated
 * addresses. A name is never copied onto another venue.
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
  { ...KANG, venue: "hyperliquid", home: true },

  {
    venue: "lighter",
    address: "0xa5Fd942D4bAdBab4FE84a9E10F565dd40d5f15Ff",
    name: "Insertive Capital",
    home: true,
  },
  {
    venue: "lighter",
    address: "0x423c026a39FE50069f3d93a0ec2b37Bd7183a411",
    name: "Guinea Pool",
    home: true,
  },

  {
    venue: "risex",
    address: "0xbe69e095e738eb7260ad795c554aba288e1f2adc",
    name: "0xbE69…2ADc",
    home: true,
  },
  {
    venue: "risex",
    address: "0x87ff50c06ca6d01165b4f03eee552cf5e3ba7eb3",
    name: "0x87ff…7eB3",
    home: true,
  },

  {
    venue: "pacifica",
    address: "9SL9PHbdixQFyMS5npowKXLdXUWwYReHKuyBrFdFCRxc",
    name: "John Locke",
    home: true,
  },
  {
    venue: "pacifica",
    address: "5RmsTTwkXQgKcTv5BK6CZEjHQMBVLVQVt8po3h5cQabB",
    name: "monogram",
    home: true,
  },

  { ...ANSEM, venue: "hyperliquid" },
  { ...TATE, venue: "hyperliquid" },
  {
    venue: "lighter",
    address: "0x6995743591A94894b54552eDECB57acCe8A2F19E",
    name: "pmalt",
  },
  {
    venue: "lighter",
    address: "0xED0A47496885CA2f68f35a8851e8e20D2a6312e1",
    name: "Silentist",
  },
];

export const GALLERY = NOTABLE.filter((n) => n.home);
