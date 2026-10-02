import { z } from "zod";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import { clearKioskPinAttempts } from "@baumy/db/kiosk-pin";
import { hasKioskPin, setKioskPinHash } from "@baumy/db/members";
import { KioskPin } from "@baumy/types";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { defineAction } from "./define";
import { fail } from "./result";

// /settings: set your own kiosk PIN (SPEC §6.2). Only from your own session,
// never the kiosk. Setting the first PIN needs nothing more; changing one
// needs "Confirm it's you" (`requireRecentAuth`, issue #135): a session
// signed in, or confirmed by any of the member's methods, in the last 10
// minutes, so a phone left unlocked on the table cannot be used to take over
// someone's kiosk attestation. Setting it also lifts a lock from failed PIN
// attempts (`kiosk_pin_locked_at`) and forgets the attempts counted so far,
// on every kiosk, in the same transaction.
//
// The PIN never reaches the ledger or the audit row: the fingerprint leaves
// it out, and the result does not hold it.

const input = z.strictObject({
  pin: KioskPin.describe("4 to 6 digits."),
});

export interface SetKioskPinData {
  /** True when a PIN was replaced, false when this was the first. */
  changed: boolean;
}

export const setKioskPin = defineAction({
  name: "set_kiosk_pin",
  title: "Set my kiosk PIN",
  description:
    "Sets or changes the signed-in member's own kiosk PIN (4 to 6 digits). Changing an existing PIN needs a recent 'Confirm it's you'.",
  consent: "Set your kiosk PIN",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  rateLimit: { perMember: 10, perIp: 30, windowMs: 15 * 60_000 },
  fingerprint: () => ({ pin: "[hidden]" }),
  input,
  async execute(ctx, { pin }) {
    const { actor } = ctx;
    // The session gate has checked both.
    if (actor.kind !== "member" || !actor.memberId) {
      return fail("FORBIDDEN", "Sign in on your own device to do this.");
    }
    const changed = await hasKioskPin(ctx.db, actor.memberId);
    if (changed) {
      const recent = await requireRecentAuth(ctx);
      if (!recent.ok) return recent;
    }
    await setKioskPinHash(ctx.db, actor.memberId, await hashKioskPin(pin));
    await clearKioskPinAttempts(ctx.db, actor.memberId);
    const data: SetKioskPinData = { changed };
    return {
      ok: true,
      data,
      audit: { entity: "member", entityId: actor.memberId, payload: data },
    };
  },
});
