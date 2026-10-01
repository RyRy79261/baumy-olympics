import { z } from "zod";
import {
  approveKioskPairing as approveRequest,
  lockKioskPairingByCode,
} from "@baumy/db/kiosk-pairing";
import { KioskDeviceName, KioskPairingCode } from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// /admin/kitchen-screen/approve (issue #126, SPEC §6.2): an admin scans the
// QR code on the unpaired iPad and confirms "Make this iPad the kitchen
// screen?". This creates the device row; the iPad, polling, then trades its
// own secret for the device token (lib/kiosk/pairing.ts). The code only
// names the request: the iPad's secret never leaves its httpOnly cookie.
//
// Admin only and UI only (SPEC §12 decision 10), so never the kiosk itself,
// the AI command, MCP or brain. The request row is locked, then approved with
// a compare-and-set, so two admins approving at once pair one device.

export interface ApproveKioskPairingData {
  deviceId: string;
  name: string;
  /** The browser that asked, e.g. "Safari on iPad". */
  device: string;
}

export const approveKioskPairing = defineAction({
  name: "approve_kiosk_pairing",
  title: "Make an iPad the kitchen screen",
  description:
    "Approves the pairing code an unpaired iPad shows at /kiosk/pair (its QR code), so that iPad signs in as the household's kitchen screen, a device rather than a person.",
  consent: "Pair kitchen screens with the household",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  rateLimit: { perMember: 20, perIp: 30, windowMs: 10 * 60_000 },
  input: z.strictObject({
    code: KioskPairingCode.describe('The code the iPad shows, e.g. "ABC-234".'),
    name: KioskDeviceName.describe('What to call the screen, e.g. "Kitchen".'),
  }),
  async execute(ctx, { code, name }) {
    const request = await lockKioskPairingByCode(
      ctx.db,
      ctx.householdId,
      code,
      ctx.now,
    );
    if (!request) {
      return fail(
        "NOT_FOUND",
        "No iPad is showing that code. Check it against the iPad's screen.",
      );
    }
    if (request.state === "expired") {
      return fail(
        "WINDOW_CLOSED",
        "That code has expired. The iPad shows a new one: scan that instead.",
      );
    }
    if (request.state !== "pending") {
      return fail(
        "INVALID_STATE",
        "That iPad was already approved. Look at the iPad: it should be the kitchen screen now.",
      );
    }
    const approved = await approveRequest(ctx.db, {
      requestId: request.id,
      householdId: ctx.householdId,
      name,
      approvedBy: ctx.actor.memberId!,
      expiresAt: request.expiresAt,
      now: ctx.now,
    });
    if (!approved) {
      // The row was locked and pending a moment ago, so this is a lost race
      // in the same millisecond as its expiry. Returning a failure rolls the
      // device row back.
      return fail(
        "INVALID_STATE",
        "That code has just expired or was approved. Scan the iPad again.",
      );
    }
    const data: ApproveKioskPairingData = {
      deviceId: approved.deviceId,
      name,
      device: request.device,
    };
    return {
      ok: true,
      data,
      audit: {
        entity: "kiosk_device",
        entityId: approved.deviceId,
        // Never the code: it names a request that may still be live.
        payload: { name, device: request.device, requestId: request.id },
      },
    };
  },
});
