import { describe, expect, it } from "vitest";
import { signInWithBaumyEnabled } from "./flag";

describe("signInWithBaumyEnabled", () => {
  it("is on only for SIGN_IN_WITH_BAUMY=on", () => {
    expect(signInWithBaumyEnabled({ SIGN_IN_WITH_BAUMY: "on" })).toBe(true);
    expect(signInWithBaumyEnabled({ SIGN_IN_WITH_BAUMY: " on " })).toBe(true);
    for (const v of [undefined, "", "off", "1", "true", "ON"]) {
      expect(signInWithBaumyEnabled({ SIGN_IN_WITH_BAUMY: v })).toBe(false);
    }
  });
});
