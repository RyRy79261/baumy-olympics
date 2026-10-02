import { describe, expect, it } from "vitest";
import {
  NO_OFFER_YET,
  OFFER_GAP_MS,
  SNOOZE_MS,
  offered,
  shouldOffer,
  snoozed,
} from "./offer";

// "Report this bug" is optional, never blocks, and an error loop cannot keep
// putting it up.

const uncaught = { source: "window.error" };

describe("shouldOffer", () => {
  it("offers an uncaught error or rejection, never a console line", () => {
    expect(shouldOffer(uncaught, NO_OFFER_YET, 0, false)).toBe(true);
    expect(
      shouldOffer({ source: "unhandledrejection" }, NO_OFFER_YET, 0, false),
    ).toBe(true);
    expect(
      shouldOffer({ source: "console.error" }, NO_OFFER_YET, 0, false),
    ).toBe(false);
  });

  it("stays quiet while the reporter or the offer is up", () => {
    expect(shouldOffer(uncaught, NO_OFFER_YET, 0, true)).toBe(false);
  });

  it("offers at most once every ten minutes", () => {
    const after = offered(NO_OFFER_YET, 1000);
    expect(shouldOffer(uncaught, after, 1000 + OFFER_GAP_MS - 1, false)).toBe(
      false,
    );
    expect(shouldOffer(uncaught, after, 1000 + OFFER_GAP_MS, false)).toBe(true);
  });

  it("holds every offer for half an hour after Not now", () => {
    const state = snoozed(offered(NO_OFFER_YET, 0), 0);
    expect(shouldOffer(uncaught, state, SNOOZE_MS - 1, false)).toBe(false);
    expect(shouldOffer(uncaught, state, SNOOZE_MS, false)).toBe(true);
  });
});
