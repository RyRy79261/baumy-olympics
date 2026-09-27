import { z } from "zod";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import { hasKioskPin, setKioskPinHash } from "@baumy/db/members";
import { KioskPin } from "@baumy/types";
import { verifyCurrentPassword } from "@/lib/auth/password-check";
import { defineAction } from "./define";
import { fail } from "./result";

// /settings: set your own kiosk PIN (SPEC §6.2). Only from your own session,
// never the kiosk. Setting the first PIN needs nothing more; changing one
// needs the account password or a session signed in under 10 minutes ago,
// so a phone left unlocked on the table cannot be used to take over
// someone's kiosk attestation. Setting it also lifts a lock from failed PIN
// attempts (`kiosk_pin_locked_at`).
//
// Neither the PIN nor the password reaches the ledger or the audit row: the
// fingerprint leaves both out, and the result holds neither.

export const FRESH_SESSION_MS = 10 * 60_000;

const input = z.strictObject({
  pin: KioskPin.describe("4 to 6 digits."),
  currentPassword: z
    .string()
    .max(256)
    .optional()
    .describe("Your account password, needed to change an existing PIN."),
});

export interface SetKioskPinData {
  /** True when a PIN was replaced, false when this was the first. */
  changed: boolean;
}

export const setKioskPin = defineAction({
  name: "set_kiosk_pin",
  title: "Set my kiosk PIN",
  description:
    "Sets or changes the signed-in member's own kiosk PIN (4 to 6 digits). Changing an existing PIN needs the account password or a session under 10 minutes old.",
  consent: "Set your kiosk PIN",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  // Each attempt may check a password: keep guessing slow.
  rateLimit: { perMember: 5, perIp: 20, windowMs: 15 * 60_000 },
  fingerprint: () => ({ pin: "[hidden]" }),
  input,
  async execute(ctx, { pin, currentPassword }) {
    const { actor } = ctx;
    // The session gate has checked both.
    if (actor.kind !== "member" || !actor.memberId) {
      return fail("FORBIDDEN", "Sign in on your own device to do this.");
    }
    const changed = await hasKioskPin(ctx.db, actor.memberId);
    if (changed) {
      const age = ctx.now.getTime() - Date.parse(actor.sessionCreatedAt);
      const fresh = age >= 0 && age < FRESH_SESSION_MS;
      if (!fresh) {
        if (!currentPassword) {
          return fail(
            "REAUTH_REQUIRED",
            "Enter your account password to change your PIN, or sign in again and change it within 10 minutes.",
          );
        }
        if (!(await verifyCurrentPassword(currentPassword))) {
          return fail("REAUTH_REQUIRED", "That password is not right.");
        }
      }
    }
    await setKioskPinHash(ctx.db, actor.memberId, await hashKioskPin(pin));
    const data: SetKioskPinData = { changed };
    return {
      ok: true,
      data,
      audit: { entity: "member", entityId: actor.memberId, payload: data },
    };
  },
});
