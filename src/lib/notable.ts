/**
 * Traders worth putting on the front page.
 *
 * Hand-curated on purpose. The version of this that read the tape and showed whoever
 * happened to be trading was worse than nothing: an address with no name attached and no
 * result attached answers no question anybody has. A name people recognise, next to a
 * number, is a reason to click.
 *
 * Add an entry and it appears. Leave the list empty and the section does not render at
 * all, which is the correct state until there is something real to put in it.
 *
 * `note` is the one line under the name. Keep it factual and short: what they are known
 * for, not a description of the trade. The trade's own numbers are read live from the
 * chain and rendered beside it, so nothing here can go stale except the note.
 */
export interface Notable {
  /** Their Hyperliquid address, lowercase. */
  address: string;
  /** What to call them. A handle, a name, whatever they are known as. */
  name: string;
  /** One short line. Optional. */
  note?: string;
}

export const NOTABLE: Notable[] = [
  // { address: "0x…", name: "…", note: "…" },
];
