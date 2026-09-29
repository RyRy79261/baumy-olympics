import { randomBytes } from "node:crypto";

// The kiosk's two cookies (SPEC §6.2, §8).
//
// - `baumy_kiosk`: the device token, 32 random bytes, for a year. Only its
//   sha256 is stored (kiosk_devices.token_hash).
// - `baumy_kiosk_member`: the member whose avatar was tapped, a member id and
//   nothing more. The PIN is NEVER stored here or anywhere: an attested
//   request carries it in that request. The screen clears the pick after 60
//   seconds idle; this cookie's own 10-minute life is the backstop if the
//   screen does not.
//
// Both are `HttpOnly; Secure; SameSite=Strict; Path=/`. Browsers accept a
// Secure cookie from http://localhost, so dev and e2e need no exception;
// an iPad reaching a dev machine over plain http on the LAN cannot pair.

export const KIOSK_COOKIE = "baumy_kiosk";
export const KIOSK_MEMBER_COOKIE = "baumy_kiosk_member";

export const KIOSK_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;
export const KIOSK_MEMBER_MAX_AGE_S = 10 * 60;

/**
 * `baumy_kiosk_walk_in` (issue #111): set by the tap that picks a member,
 * for a minute, to the member's id; the dashboard plays that member's walk
 * pose once for it and the screen forgets it at once
 * (components/kiosk/forget-cookie.tsx), so going back to Home later does
 * not walk them in again. Not HttpOnly, so the screen can clear it; it
 * holds nothing but a member id the screen already shows.
 */
export const KIOSK_WALK_IN_COOKIE = "baumy_kiosk_walk_in";
export const KIOSK_WALK_IN_MAX_AGE_S = 60;

export function walkInCookieOptions() {
  return {
    httpOnly: false,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: KIOSK_WALK_IN_MAX_AGE_S,
  };
}

/** Whether the dashboard should walk `memberId` in: they were just tapped. */
export function walksIn(
  cookie: string | undefined,
  memberId: string | undefined,
): boolean {
  return memberId !== undefined && cookie === memberId;
}

/** A token is 43 base64url characters; anything much longer is not ours. */
export const KIOSK_TOKEN_MAX_LENGTH = 128;

export interface KioskCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "strict";
  path: "/";
  maxAge: number;
}

export function kioskCookieOptions(maxAge: number): KioskCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}

/** A fresh device token: 32 random bytes, base64url. */
export function generateKioskToken(): string {
  return randomBytes(32).toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a cookie value can be a member id at all, before any query. */
export function isMemberId(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}
