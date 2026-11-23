/**
 * The registry, checked against itself.
 *
 * A venue exists in three places — the `VENUES` list, the adapter map, and the
 * mark map — and TypeScript only enforces the mark map (it is a total
 * `Record`). The adapter map is total too, but nothing checks the two agree on
 * ids, and nothing checks an adapter accepts the address kind its registry
 * entry promises. That is exactly the seam a new venue tears: the page renders
 * the chip, the paste resolves to the venue, and the adapter answers "not an
 * address" for the format the picker offered.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { adapter } from "@/lib/venues";
import { isVenueId, kindOfAddress, VENUES, VENUE_MARK, venueFits } from "@/lib/venue";

const SAMPLE: Record<string, string> = {
  evm: `0x${"1".repeat(40)}`,
  solana: "9J8TUdEWrrcADK913r1Cs7DdqX63VdVU88imfDzT1ypt",
  dydx: `dydx1${"a".repeat(40)}`,
};

describe("venue registry", () => {
  test("every venue has an adapter that answers to its own id", () => {
    for (const v of VENUES) {
      assert.equal(adapter(v.id).id, v.id, `${v.id} adapter id`);
    }
  });

  test("every venue files a mark under /venues", () => {
    for (const v of VENUES) {
      assert.ok(VENUE_MARK[v.id]?.startsWith("/venues/"), `${v.id} mark`);
    }
  });

  test("every adapter accepts the address kind its registry entry promises", () => {
    for (const v of VENUES) {
      const address = SAMPLE[v.kind];
      assert.ok(address, `${v.id} has a sample for ${v.kind}`);
      assert.equal(kindOfAddress(address), v.kind, `${v.id} sample parses as ${v.kind}`);
      assert.equal(venueFits(v.id, address), true, `${v.id} fits ${v.kind}`);
      assert.equal(adapter(v.id).isAddress(address), true, `${v.id} adapter accepts ${v.kind}`);
    }
  });

  test("isVenueId knows every registry id and nothing else pretends to be one", () => {
    for (const v of VENUES) assert.equal(isVenueId(v.id), true);
    assert.equal(isVenueId("nope"), false);
  });
});
