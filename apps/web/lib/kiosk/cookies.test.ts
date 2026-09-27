import { describe, expect, it } from "vitest";
import {
  KIOSK_COOKIE_MAX_AGE_S,
  generateKioskToken,
  isMemberId,
  kioskCookieOptions,
} from "./cookies";
import { PIN_PROMPT_CODES } from "./constants";
import { formatKioskPairingCode } from "./format";

describe("kiosk cookies", () => {
  it("are HttpOnly, Secure, SameSite=Strict on / for a year", () => {
    expect(kioskCookieOptions(KIOSK_COOKIE_MAX_AGE_S)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 31_536_000,
    });
  });

  it("carry a fresh 32-byte token each time", () => {
    const a = generateKioskToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateKioskToken()).not.toBe(a);
  });

  it("only take a uuid as the picked member", () => {
    expect(isMemberId("0b6f1c1e-6a6e-4c4b-9d55-6a8f0f3a2b10")).toBe(true);
    expect(isMemberId(undefined)).toBe(false);
    expect(isMemberId("m1")).toBe(false);
  });
});

describe("kiosk display helpers", () => {
  it("formats a pairing code in two halves", () => {
    expect(formatKioskPairingCode("ABCD2345")).toBe("ABCD-2345");
  });

  it("opens the PIN pad for the attestation codes only", () => {
    expect(PIN_PROMPT_CODES.has("ATTESTATION_REQUIRED")).toBe(true);
    expect(PIN_PROMPT_CODES.has("PIN_LOCKED")).toBe(false);
  });
});
