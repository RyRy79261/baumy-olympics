import { describe, expect, it } from "vitest";
import {
  KIOSK_COOKIE_MAX_AGE_S,
  generateKioskToken,
  isMemberId,
  KIOSK_WALK_IN_MAX_AGE_S,
  kioskCookieOptions,
  walkInCookieOptions,
  walksIn,
} from "./cookies";
import { PIN_PROMPT_CODES } from "./constants";
import { formatKioskPairingCode, kioskApproveUrl } from "./format";

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
    expect(formatKioskPairingCode("ABC234")).toBe("ABC-234");
  });

  it("puts the code in the approve URL the QR code holds", () => {
    expect(kioskApproveUrl("https://baumy.example", "ABC234")).toBe(
      "https://baumy.example/admin/kitchen-screen/approve?code=ABC234",
    );
  });

  it("opens the PIN pad for the attestation codes only", () => {
    expect(PIN_PROMPT_CODES.has("ATTESTATION_REQUIRED")).toBe(true);
    expect(PIN_PROMPT_CODES.has("PIN_LOCKED")).toBe(false);
  });
});

describe("the walk-in cookie (issue #111)", () => {
  it("walks in only the member the tap just picked", () => {
    expect(walksIn("m1", "m1")).toBe(true);
    expect(walksIn(undefined, "m1")).toBe(false);
    expect(walksIn("m2", "m1")).toBe(false);
    expect(walksIn(undefined, undefined)).toBe(false);
  });

  it("lives a minute and the screen may clear it", () => {
    expect(walkInCookieOptions()).toEqual({
      httpOnly: false,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: KIOSK_WALK_IN_MAX_AGE_S,
    });
  });
});
