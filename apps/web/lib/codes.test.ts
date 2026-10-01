import { describe, expect, it } from "vitest";
import { KioskPairingCode } from "@baumy/types";
import {
  CODE_ALPHABET,
  generateInviteCode,
  generateKioskPairingCode,
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

  it("kiosk pairing codes are 6 uppercase characters the approve form takes", () => {
    const code = generateKioskPairingCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(KioskPairingCode.parse(code)).toBe(code);
    expect(generateKioskPairingCode()).not.toBe(code);
  });
});
