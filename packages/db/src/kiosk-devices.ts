import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { createHttpDb, type Queryable } from "./index";
import { kioskDevices } from "./schema";

// Kiosk devices (SPEC §5, §6.2): the kitchen iPad signs in as a device.
//
//   1. An admin's `pair_kiosk` stores the sha256 of an 8-character pairing
//      code on a new row (insertKioskPairing). It lasts 10 minutes.
//   2. The iPad sends the code to `/kiosk/pair`; claimKioskPairing swaps it,
//      in ONE `UPDATE … RETURNING`, for the sha256 of a fresh random token,
//      so two iPads racing with one code cannot both get it.
//   3. Every kiosk request looks its cookie's token up by hash
//      (findPairedKioskDevice). A revoked device is never found.
//
// Every function but the request-path lookups takes the caller's handle (the
// action's transaction) and the caller's clock.

/** A pairing code lives this long. */
export const KIOSK_PAIRING_TTL_MS = 10 * 60_000;

/** `last_seen_at` is written at most this often per device. */
export const KIOSK_SEEN_EVERY_MS = 5 * 60_000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The one spelling of a pairing code: no spaces or dashes, uppercase. It is
 * shown as `ABCD-EFGH` and typed however the iPad keyboard likes.
 */
export function normalizePairingCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * The stored form of a pairing code. 8 random characters from a 31-letter
 * alphabet is about 40 bits, alive for 10 minutes behind a per-IP limit, so
 * a plain sha256 is enough.
 */
export function hashPairingCode(code: string): string {
  return sha256Hex(normalizePairingCode(code));
}

/**
 * The stored form of a device token: sha256 hex. The token is 32 random
 * bytes, so nothing slower is needed.
 */
export function hashKioskToken(token: string): string {
  return sha256Hex(token);
}

export type KioskDeviceRow = typeof kioskDevices.$inferSelect;

/**
 * Store a new device's pairing code. Returns null, writing nothing, if the
 * code's hash is already taken (a collision; the caller mints another).
 */
export async function insertKioskPairing(
  db: Queryable,
  input: {
    householdId: string;
    name: string;
    code: string;
    pairedBy: string;
    now: Date;
  },
): Promise<{ id: string; expiresAt: Date } | null> {
  const expiresAt = new Date(input.now.getTime() + KIOSK_PAIRING_TTL_MS);
  const [row] = await db
    .insert(kioskDevices)
    .values({
      householdId: input.householdId,
      name: input.name,
      pairingCodeHash: hashPairingCode(input.code),
      pairingExpiresAt: expiresAt,
      pairedBy: input.pairedBy,
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: kioskDevices.pairingCodeHash })
    .returning({ id: kioskDevices.id });
  return row ? { id: row.id, expiresAt } : null;
}

/**
 * Use a pairing code, once: ONE `UPDATE … RETURNING` whose WHERE is the whole
 * "still usable" test (not used, not expired, not revoked). It clears the
 * code and stores the token's hash. A second use of the code, or a
 * concurrent one, finds no row. Returns the paired device, or null.
 */
export async function claimKioskPairing(
  db: Queryable,
  input: { code: string; tokenHash: string; now: Date },
): Promise<{ id: string; householdId: string; name: string } | null> {
  const [row] = await db
    .update(kioskDevices)
    .set({
      tokenHash: input.tokenHash,
      pairingCodeHash: null,
      pairedAt: input.now,
      lastSeenAt: input.now,
    })
    .where(
      and(
        eq(kioskDevices.pairingCodeHash, hashPairingCode(input.code)),
        isNull(kioskDevices.pairedAt),
        isNull(kioskDevices.revokedAt),
        gt(kioskDevices.pairingExpiresAt, input.now),
      ),
    )
    .returning({
      id: kioskDevices.id,
      householdId: kioskDevices.householdId,
      name: kioskDevices.name,
    });
  return row ?? null;
}

export interface PairedKioskDevice {
  id: string;
  householdId: string;
  name: string;
  lastSeenAt: Date | null;
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
 * Revoke a device (or cancel its unused code). Compare-and-set: only a
 * device of this household not already revoked. Returns it, or null.
 */
export async function revokeKioskDevice(
  db: Queryable,
  input: { householdId: string; id: string; now: Date },
): Promise<{ id: string; name: string; paired: boolean } | null> {
  const [row] = await db
    .update(kioskDevices)
    .set({ revokedAt: input.now, pairingCodeHash: null })
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

export type KioskDeviceState = "waiting" | "expired" | "paired" | "revoked";

/** Where a device stands: waiting for its code, never paired, or paired. */
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
