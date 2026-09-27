import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  generateInviteCode,
  generateTelegramLinkCode,
  randomCode,
} from "./codes";

describe("codes", () => {
  it("randomCode draws only from the alphabet, with no look-alikes", () => {
    const code = randomCode(500);
    expect(code).toHaveLength(500);
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]+$`));
    expect(CODE_ALPHABET).not.toMatch(/[01ilo]/);
  });

  it("invite codes are three lowercase groups of four, and differ", () => {
    const a = generateInviteCode();
    expect(a).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(generateInviteCode()).not.toBe(a);
  });

  it("telegram link codes are 10 uppercase characters (at least 8)", () => {
    const code = generateTelegramLinkCode();
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    expect(generateTelegramLinkCode()).not.toBe(code);
  });
});
