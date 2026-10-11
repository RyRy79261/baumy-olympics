import { describe, expect, it } from "vitest";
import { FIXED_NOW } from "@/test-utils/actions";
import { NEW_BOUNTY_MS, isNewChore } from "./new-bounty";

describe("isNewChore", () => {
  it("is new for three days after it was added, and not a moment longer", () => {
    expect(NEW_BOUNTY_MS).toBe(3 * 24 * 60 * 60_000);
    const just = new Date(FIXED_NOW.getTime() - NEW_BOUNTY_MS + 1);
    const gone = new Date(FIXED_NOW.getTime() - NEW_BOUNTY_MS);
    expect(isNewChore(just, FIXED_NOW)).toBe(true);
    expect(isNewChore(gone, FIXED_NOW)).toBe(false);
  });
});
