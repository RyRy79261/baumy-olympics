import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { createHttpDb, type Queryable } from "./index";
import { kioskDevices } from "./schema";

// Kiosk devices (SPEC §5, §6.2): the kitchen iPad signs in as a device.
//
//   1. The iPad asks to be paired and an admin approves it by scanning its
//      QR code (kiosk-pairing.ts, issue #126), which creates the row here,
//      unpaired; the iPad's next poll stores the sha256 of its fresh token.
//   2. Every kiosk request looks its cookie's token up by hash
//      (findPairedKioskDevice). A revoked device is never found.
//
// Every function but the request-path lookups takes the caller's handle (the
// action's transaction) and the caller's clock.

/** `last_seen_at` is written at most this often per device. */
export const KIOSK_SEEN_EVERY_MS = 5 * 60_000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The stored form of a device token: sha256 hex. The token is 32 random
 * bytes, so nothing slower is needed.
 */
export function hashKioskToken(token: string): string {
  return sha256Hex(token);
}

export type KioskDeviceRow = typeof kioskDevices.$inferSelect;

export interface PairedKioskDevice {
  id: string;
  householdId: string;
  name: string;
  lastSeenAt: Date | null;
  /** Minutes untouched before it forgets who is acting; null: the default. */
  idleMinutes: number | null;
}

/**
 * The paired, unrevoked device whose token hashes to `tokenHash`, or null.
 * Runs on the request path before any action (apps/web/lib/auth). The
 * lookup is by the unique hash, and the stored hash is compared again in
 * constant time (AGENTS.md "Security").
 */
export async function findPairedKioskDevice(
  tokenHash: string,
): Promise<PairedKioskDevice | null> {
  const [row] = await createHttpDb()
    .select({
      id: kioskDevices.id,
      householdId: kioskDevices.householdId,
      name: kioskDevices.name,
      lastSeenAt: kioskDevices.lastSeenAt,
      idleMinutes: kioskDevices.idleMinutes,
      tokenHash: kioskDevices.tokenHash,
    })
    .from(kioskDevices)
    .where(
      and(
        eq(kioskDevices.tokenHash, tokenHash),
        isNotNull(kioskDevices.pairedAt),
        isNull(kioskDevices.revokedAt),
      ),
    )
    .limit(1);
  if (!row?.tokenHash) return null;
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const { tokenHash: _stored, ...device } = row;
  return device;
}

/**
 * Record that the device was seen, at most every KIOSK_SEEN_EVERY_MS, so a
 * kiosk refreshing every minute does not write every minute.
 */
export async function touchKioskDevice(
  device: Pick<PairedKioskDevice, "id" | "lastSeenAt">,
  now: Date,
): Promise<void> {
  const last = device.lastSeenAt?.getTime() ?? 0;
  if (now.getTime() - last < KIOSK_SEEN_EVERY_MS) return;
  await createHttpDb()
    .update(kioskDevices)
    .set({ lastSeenAt: now })
    .where(eq(kioskDevices.id, device.id));
}

/**
 * Set how long the device waits, untouched, before it forgets who is acting
 * (issue #147). Only a paired, unrevoked device of this household; returns
 * its name and the minutes it had before, or null.
 */
export async function setKioskIdleMinutes(
  db: Queryable,
  input: { householdId: string; id: string; minutes: number },
): Promise<{ name: string; before: number | null } | null> {
  const [found] = await db
    .select({ name: kioskDevices.name, before: kioskDevices.idleMinutes })
    .from(kioskDevices)
    .where(
      and(
        eq(kioskDevices.id, input.id),
        eq(kioskDevices.householdId, input.householdId),
        isNotNull(kioskDevices.pairedAt),
        isNull(kioskDevices.revokedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!found) return null;
  await db
    .update(kioskDevices)
    .set({ idleMinutes: input.minutes })
    .where(eq(kioskDevices.id, input.id));
  return found;
}

/**
 * Revoke a device (or cancel an approval its iPad has not picked up).
 * Compare-and-set: only a device of this household not already revoked.
 * Returns it, or null.
 */
export async function revokeKioskDevice(
  db: Queryable,
  input: { householdId: string; id: string; now: Date },
): Promise<{ id: string; name: string; paired: boolean } | null> {
  const [row] = await db
    .update(kioskDevices)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(kioskDevices.id, input.id),
        eq(kioskDevices.householdId, input.householdId),
        isNull(kioskDevices.revokedAt),
      ),
    )
    .returning({
      id: kioskDevices.id,
      name: kioskDevices.name,
      pairedAt: kioskDevices.pairedAt,
    });
  return row
    ? { id: row.id, name: row.name, paired: row.pairedAt !== null }
    : null;
}

/**
 * Rename a device. Compare-and-set: only a device of this household that is
 * not revoked. Returns it, or null.
 */
export async function renameKioskDevice(
  db: Queryable,
  input: { householdId: string; id: string; name: string },
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .update(kioskDevices)
    .set({ name: input.name })
    .where(
      and(
        eq(kioskDevices.id, input.id),
        eq(kioskDevices.householdId, input.householdId),
        isNull(kioskDevices.revokedAt),
      ),
    )
    .returning({ id: kioskDevices.id, name: kioskDevices.name });
  return row ?? null;
}

export type KioskDeviceState = "waiting" | "expired" | "paired" | "revoked";

/**
 * Where a device stands: approved and waiting for its iPad to pick the
 * approval up, never picked up, paired, or revoked.
 */
export function kioskDeviceState(
  row: Pick<KioskDeviceRow, "revokedAt" | "pairedAt" | "pairingExpiresAt">,
  now: Date,
): KioskDeviceState {
  if (row.revokedAt) return "revoked";
  if (row.pairedAt) return "paired";
  if (row.pairingExpiresAt && row.pairingExpiresAt.getTime() > now.getTime()) {
    return "waiting";
  }
  return "expired";
}

export type KioskDeviceListing = Pick<
  KioskDeviceRow,
  | "id"
  | "name"
  | "pairingExpiresAt"
  | "pairedAt"
  | "lastSeenAt"
  | "revokedAt"
  | "createdAt"
>;

/** The household's devices, newest first. Never the hashes. */
export async function listKioskDevices(
  db: Queryable,
  householdId: string,
): Promise<KioskDeviceListing[]> {
  return db
    .select({
      id: kioskDevices.id,
      name: kioskDevices.name,
      pairingExpiresAt: kioskDevices.pairingExpiresAt,
      pairedAt: kioskDevices.pairedAt,
      lastSeenAt: kioskDevices.lastSeenAt,
      revokedAt: kioskDevices.revokedAt,
      createdAt: kioskDevices.createdAt,
    })
    .from(kioskDevices)
    .where(eq(kioskDevices.householdId, householdId))
    .orderBy(desc(kioskDevices.createdAt), desc(kioskDevices.id));
}
