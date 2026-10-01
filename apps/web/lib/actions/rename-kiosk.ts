import { z } from "zod";
import { renameKioskDevice } from "@baumy/db/kiosk-devices";
import { KioskDeviceName } from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// /admin/kitchen-screen (issue #126): an admin renames a kitchen screen.
// Compare-and-set: only a device of this household that is not revoked.
// Admin only, UI only.

export interface RenameKioskData {
  deviceId: string;
  name: string;
}

export const renameKiosk = defineAction({
  name: "rename_kiosk",
  title: "Rename a kitchen screen",
  description: "Renames a kitchen screen (a paired kiosk device).",
  consent: "Rename kitchen screens",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    deviceId: z.uuid("Which screen?"),
    name: KioskDeviceName,
  }),
  async execute(ctx, { deviceId, name }) {
    const row = await renameKioskDevice(ctx.db, {
      householdId: ctx.householdId,
      id: deviceId,
      name,
    });
    if (!row) {
      return fail("NOT_FOUND", "That screen doesn't exist or was revoked.");
    }
    const data: RenameKioskData = { deviceId: row.id, name: row.name };
    return {
      ok: true,
      data,
      audit: { entity: "kiosk_device", entityId: row.id, payload: data },
    };
  },
});
