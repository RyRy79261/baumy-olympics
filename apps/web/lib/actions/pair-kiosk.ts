import { z } from "zod";
import { insertKioskPairing } from "@baumy/db/kiosk-devices";
import { KioskDeviceName } from "@baumy/types";
import { generateKioskPairingCode } from "@/lib/codes";
import { defineAction } from "./define";

// /admin/members: an admin creates a pairing code for a new kiosk (SPEC
// §6.2). 8 characters, 10 minutes, one use; the iPad types it at
// /kiosk/pair. Admin actions are UI only (SPEC §12 decision 10), so never on
// the kiosk itself. Only the code's hash is stored, and the ledger keeps the
// result WITHOUT the code: the admin sees it once.

/** Codes are random; a collision is astronomically rare, but never fatal. */
const MINT_ATTEMPTS = 5;

export interface PairKioskData {
  deviceId: string;
  name: string;
  /** Null on a replay: the code is shown once and never stored. */
  code: string | null;
  expiresAt: string;
}

export const pairKiosk = defineAction({
  name: "pair_kiosk",
  title: "Pair a kiosk",
  description:
    "Creates a one-time pairing code, valid for 10 minutes, that signs a kitchen kiosk (an iPad) in as a household device when typed at /kiosk/pair.",
  consent: "Pair kitchen kiosks with the household",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  rateLimit: { perMember: 10, perIp: 30, windowMs: 10 * 60_000 },
  input: z.strictObject({
    name: KioskDeviceName.describe(
      'What to call the device, e.g. "Kitchen iPad".',
    ),
  }),
  async execute(ctx, { name }) {
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const code = generateKioskPairingCode();
      const row = await insertKioskPairing(ctx.db, {
        householdId: ctx.householdId,
        name,
        code,
        pairedBy: ctx.actor.memberId!,
        now: ctx.now,
      });
      if (!row) continue;
      const data: PairKioskData = {
        deviceId: row.id,
        name,
        code,
        expiresAt: row.expiresAt.toISOString(),
      };
      return {
        ok: true,
        data,
        storedData: { ...data, code: null },
        audit: {
          entity: "kiosk_device",
          entityId: row.id,
          payload: { name, expiresAt: data.expiresAt },
        },
      };
    }
    throw new Error("pair_kiosk: no free code after several attempts");
  },
});
