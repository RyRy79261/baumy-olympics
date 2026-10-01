import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Queryable } from "./index";
import { kioskDevices, kioskPairingRequests } from "./schema";

// Pairing the kitchen iPad by QR code (issue #126, SPEC §6.2).
//
//   1. The unpaired iPad at `/kiosk/pair` starts a request
//      (insertKioskPairingRequest): a random secret it keeps in an httpOnly
//      cookie and a short code it shows as a QR code. Only their sha256s
//      are stored. It lasts 10 minutes.
//   2. An admin scans the code on their phone and approves it
//      (`approve_kiosk_pairing`: lockKioskPairingByCode, then
//      approveKioskPairing), which creates the device row.
//   3. The iPad, polling with its cookie, trades the approved request for a
//      device token, once (claimApprovedKioskPairing).
//
// Every step is ONE statement whose WHERE is the whole test, so a replayed or
// concurrent step finds no row. Hashes are looked up by their unique index,
// then compared again in constant time (AGENTS.md "Security"). These
// functions take the caller's handle and clock, and write neither
// `audit_events` nor `action_requests`.

/** A request can be approved for this long. */
export const KIOSK_PAIRING_TTL_MS = 10 * 60_000;

/**
 * An approved request can still be traded for a token this long after it
 * expired, so an approval at 9:59 does not lose to the iPad's next poll.
 */
export const KIOSK_PAIRING_EXCHANGE_GRACE_MS = 30_000;

/** How long rows are kept, for the audit trail (the daily sweep). */
export const KIOSK_PAIRING_RETENTION_MS = 24 * 60 * 60_000;

export type KioskPairingState = "pending" | "approved" | "expired" | "used";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The stored hash equals the one just computed, in constant time. */
function sameHash(stored: string, computed: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(computed);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The one spelling of a pairing code: no spaces or dashes, uppercase. It is
 * shown as `ABC-DEF` and typed however the phone's keyboard likes.
 */
export function normalizeKioskPairingCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * The stored form of a pairing code. Knowing a code gives nobody anything
 * but an admin (only an admin can approve), and it lives 10 minutes, so a
 * plain sha256 is enough.
 */
export function hashKioskPairingCode(code: string): string {
  return sha256Hex(normalizeKioskPairingCode(code));
}

/** The stored form of the iPad's secret: 32 random bytes, so plain sha256. */
export function hashKioskPairingSecret(secret: string): string {
  return sha256Hex(secret);
}

/** What a row reads as at `now`: `expired` is derived, never stored. */
export function kioskPairingState(
  row: { status: "pending" | "approved" | "used"; expiresAt: Date },
  now: Date,
): KioskPairingState {
  const t = now.getTime();
  const expires = row.expiresAt.getTime();
  switch (row.status) {
    case "pending":
      return t < expires ? "pending" : "expired";
    case "approved":
      return t < expires + KIOSK_PAIRING_EXCHANGE_GRACE_MS
        ? "approved"
        : "expired";
    default:
      return "used";
  }
}

/**
 * Store a new request, pending for `KIOSK_PAIRING_TTL_MS`. Null, writing
 * nothing, if the code's (or the secret's) hash is already taken: a
 * collision, and the caller draws another code.
 */
export async function insertKioskPairingRequest(
  db: Queryable,
  input: {
    householdId: string;
    secret: string;
    code: string;
    device: string;
    now: Date;
  },
): Promise<{ id: string; expiresAt: Date } | null> {
  const expiresAt = new Date(input.now.getTime() + KIOSK_PAIRING_TTL_MS);
  const [row] = await db
    .insert(kioskPairingRequests)
    .values({
      householdId: input.householdId,
      secretHash: hashKioskPairingSecret(input.secret),
      codeHash: hashKioskPairingCode(input.code),
      device: input.device,
      createdAt: input.now,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: kioskPairingRequests.id });
  return row ? { id: row.id, expiresAt } : null;
}

/** Where the request this iPad holds the secret of stands, or null. */
export async function findKioskPairingBySecret(
  db: Queryable,
  secret: string,
  now: Date,
): Promise<{ id: string; state: KioskPairingState } | null> {
  const hash = hashKioskPairingSecret(secret);
  const [row] = await db
    .select({
      id: kioskPairingRequests.id,
      secretHash: kioskPairingRequests.secretHash,
      status: kioskPairingRequests.status,
      expiresAt: kioskPairingRequests.expiresAt,
    })
    .from(kioskPairingRequests)
    .where(eq(kioskPairingRequests.secretHash, hash))
    .limit(1);
  if (!row || !sameHash(row.secretHash, hash)) return null;
  return { id: row.id, state: kioskPairingState(row, now) };
}

export interface KioskPairingByCode {
  id: string;
  /** The browser that asked ("Safari on iPad"). */
  device: string;
  state: KioskPairingState;
  expiresAt: Date;
}

async function selectByCode(
  db: Queryable,
  householdId: string,
  code: string,
  now: Date,
  lock: boolean,
): Promise<KioskPairingByCode | null> {
  const hash = hashKioskPairingCode(code);
  const query = db
    .select({
      id: kioskPairingRequests.id,
      codeHash: kioskPairingRequests.codeHash,
      device: kioskPairingRequests.device,
      status: kioskPairingRequests.status,
      expiresAt: kioskPairingRequests.expiresAt,
    })
    .from(kioskPairingRequests)
    .where(
      and(
        eq(kioskPairingRequests.codeHash, hash),
        eq(kioskPairingRequests.householdId, householdId),
      ),
    )
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row || !sameHash(row.codeHash, hash)) return null;
  return {
    id: row.id,
    device: row.device,
    state: kioskPairingState(row, now),
    expiresAt: row.expiresAt,
  };
}

/** The request a code names, for the admin's confirm page, or null. */
export function findKioskPairingByCode(
  db: Queryable,
  householdId: string,
  code: string,
  now: Date,
): Promise<KioskPairingByCode | null> {
  return selectByCode(db, householdId, code, now, false);
}

/**
 * The request a code names, locked (`FOR UPDATE`) until the transaction
 * ends, or null.
 */
export function lockKioskPairingByCode(
  db: Queryable,
  householdId: string,
  code: string,
  now: Date,
): Promise<KioskPairingByCode | null> {
  return selectByCode(db, householdId, code, now, true);
}

/**
 * Approve a pending, unexpired request: create its device row (unpaired
 * until the iPad's exchange, which may come up to the grace after the
 * request's time), then a compare-and-set on the status. Null when the
 * request was no longer pending; the caller's transaction then rolls back,
 * device row and all.
 */
export async function approveKioskPairing(
  db: Queryable,
  input: {
    requestId: string;
    householdId: string;
    name: string;
    approvedBy: string;
    expiresAt: Date;
    now: Date;
  },
): Promise<{ deviceId: string } | null> {
  const [device] = await db
    .insert(kioskDevices)
    .values({
      householdId: input.householdId,
      name: input.name,
      pairingExpiresAt: new Date(
        input.expiresAt.getTime() + KIOSK_PAIRING_EXCHANGE_GRACE_MS,
      ),
      pairedBy: input.approvedBy,
      createdAt: input.now,
    })
    .returning({ id: kioskDevices.id });
  const rows = await db
    .update(kioskPairingRequests)
    .set({
      status: "approved",
      deviceId: device!.id,
      approvedBy: input.approvedBy,
      approvedAt: input.now,
    })
    .where(
      and(
        eq(kioskPairingRequests.id, input.requestId),
        eq(kioskPairingRequests.status, "pending"),
        gt(kioskPairingRequests.expiresAt, input.now),
      ),
    )
    .returning({ id: kioskPairingRequests.id });
  return rows.length > 0 ? { deviceId: device!.id } : null;
}

/**
 * Trade an approved request for a device token, once: ONE `UPDATE …
 * RETURNING` on the request whose WHERE is the whole test (this secret,
 * approved, not past its time plus the grace), then ONE on its device (not
 * paired yet, not revoked). A replay, a second tab or a race finds no row.
 * Run both in one transaction. Returns the paired device, or null.
 */
export async function claimApprovedKioskPairing(
  db: Queryable,
  input: { secret: string; tokenHash: string; now: Date },
): Promise<{ deviceId: string; name: string } | null> {
  const [claimed] = await db
    .update(kioskPairingRequests)
    .set({ status: "used", usedAt: input.now })
    .where(
      and(
        eq(
          kioskPairingRequests.secretHash,
          hashKioskPairingSecret(input.secret),
        ),
        eq(kioskPairingRequests.status, "approved"),
        gt(
          kioskPairingRequests.expiresAt,
          new Date(input.now.getTime() - KIOSK_PAIRING_EXCHANGE_GRACE_MS),
        ),
      ),
    )
    .returning({ deviceId: kioskPairingRequests.deviceId });
  if (!claimed?.deviceId) return null;
  const [device] = await db
    .update(kioskDevices)
    .set({
      tokenHash: input.tokenHash,
      pairedAt: input.now,
      lastSeenAt: input.now,
    })
    .where(
      and(
        eq(kioskDevices.id, claimed.deviceId),
        isNull(kioskDevices.pairedAt),
        isNull(kioskDevices.revokedAt),
      ),
    )
    .returning({ id: kioskDevices.id, name: kioskDevices.name });
  return device ? { deviceId: device.id, name: device.name } : null;
}

/** Delete requests created before `before` (the daily sweep). */
export async function pruneKioskPairingRequests(
  db: Queryable,
  before: Date,
): Promise<number> {
  const rows = await db
    .delete(kioskPairingRequests)
    .where(lt(kioskPairingRequests.createdAt, before))
    .returning({ id: kioskPairingRequests.id });
  return rows.length;
}
