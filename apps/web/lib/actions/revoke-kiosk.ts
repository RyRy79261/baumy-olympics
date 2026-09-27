import { z } from "zod";
import { revokeKioskDevice } from "@baumy/db/kiosk-devices";
import { defineAction } from "./define";
import { fail } from "./result";

// /admin/members: an admin signs a kiosk out for good (SPEC §6.2), or cancels
// a pairing code nobody has used yet. The device's next request finds no
// device and is sent to /kiosk/pair. Compare-and-set: only a device not
// already revoked. Admin only, UI only.

export interface RevokeKioskData {
  deviceId: string;
  name: string;
  /** False when it was only a pairing code nobody had used. */
  wasPaired: boolean;
}

export const revokeKiosk = defineAction({
  name: "revoke_kiosk",
  title: "Revoke a kiosk",
  description:
    "Signs a paired kitchen kiosk out of the household, or cancels its unused pairing code. It must be paired again with a new code.",
  consent: "Sign kitchen kiosks out of the household",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    deviceId: z.uuid("Which device?"),
  }),
  async execute(ctx, { deviceId }) {
    const row = await revokeKioskDevice(ctx.db, {
      householdId: ctx.householdId,
      id: deviceId,
      now: ctx.now,
    });
    if (!row) {
      return fail(
        "NOT_FOUND",
        "That kiosk doesn't exist or was already revoked.",
      );
    }
    const data: RevokeKioskData = {
      deviceId: row.id,
      name: row.name,
      wasPaired: row.paired,
    };
    return {
      ok: true,
      data,
      audit: { entity: "kiosk_device", entityId: row.id, payload: data },
    };
  },
});
