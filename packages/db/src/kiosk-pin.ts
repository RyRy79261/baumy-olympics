import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { createHttpDb, type Queryable } from "./index";
import { actionRateLimit, members } from "./schema";

// The database side of kiosk PIN attestation (SPEC §5, §6.2). The attempt
// counters are rows in `action_rate_limit` (rate-limit.ts), not a table of
// their own:
//
//   pin:<device>:<member>   5 per 15 minutes, per device and member;
//   pin24:<member>          10 failures per 24h, then the PIN locks
//                           (`members.kiosk_pin_locked_at`).
//
// The member lifts the lock by setting a new PIN from their own session
// (`set_kiosk_pin`), which also clears both counters.

export const KIOSK_PIN_SHORT_LIMIT = 5;
export const KIOSK_PIN_SHORT_WINDOW_MS = 15 * 60_000;
export const KIOSK_PIN_DAY_LIMIT = 10;
export const KIOSK_PIN_DAY_WINDOW_MS = 24 * 60 * 60_000;

/** The two counters one attempt at `memberId`'s PIN on `deviceId` counts in. */
export function kioskPinKeys(
  deviceId: string,
  memberId: string,
): { short: string; day: string } {
  return { short: `pin:${deviceId}:${memberId}`, day: `pin24:${memberId}` };
}

export interface KioskPinState {
  pinHash: string | null;
  lockedAt: Date | null;
}

/**
 * The PIN hash and lock of an ACTIVE member of the household, or null when
 * there is no such member. Read with the stateless driver: attestation runs
 * before the action's transaction opens.
 */
export async function findKioskPinState(
  householdId: string,
  memberId: string,
): Promise<KioskPinState | null> {
  const [row] = await createHttpDb()
    .select({
      pinHash: members.kioskPinHash,
      lockedAt: members.kioskPinLockedAt,
    })
    .from(members)
    .where(
      and(
        eq(members.id, memberId),
        eq(members.householdId, householdId),
        isNull(members.deactivatedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Lock the member's kiosk PIN. Compare-and-set: true only for the call that
 * set the lock, so exactly one audit row records it.
 */
export async function lockKioskPin(
  db: Queryable,
  memberId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(members)
    .set({ kioskPinLockedAt: now })
    .where(and(eq(members.id, memberId), isNull(members.kioskPinLockedAt)))
    .returning({ id: members.id });
  return rows.length > 0;
}

/**
 * Give one attempt back to a counter: a correct PIN is not a failure, so
 * only failures use up the limits. Never below zero.
 */
export async function refundKioskPinAttempt(key: string): Promise<void> {
  await createHttpDb()
    .update(actionRateLimit)
    .set({ count: sql`GREATEST(${actionRateLimit.count} - 1, 0)` })
    .where(eq(actionRateLimit.key, key));
}

/**
 * Forget every PIN attempt counted against `memberId`, on any device. Run in
 * the transaction that sets their new PIN, so the lock and the counters are
 * lifted together.
 */
export async function clearKioskPinAttempts(
  db: Queryable,
  memberId: string,
): Promise<void> {
  await db
    .delete(actionRateLimit)
    .where(
      or(
        eq(actionRateLimit.key, `pin24:${memberId}`),
        like(actionRateLimit.key, `pin:%:${memberId}`),
      ),
    );
}
