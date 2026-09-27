import "server-only";

import { withTransaction, type Queryable } from "@baumy/db";
import { verifyKioskPin as checkPinHash } from "@baumy/auth/kiosk-pin";
import {
  KIOSK_PIN_DAY_LIMIT,
  KIOSK_PIN_DAY_WINDOW_MS,
  KIOSK_PIN_SHORT_LIMIT,
  KIOSK_PIN_SHORT_WINDOW_MS,
  findKioskPinState,
  kioskPinKeys,
  lockKioskPin,
  refundKioskPinAttempt,
  type KioskPinState,
} from "@baumy/db/kiosk-pin";
import { consumeRateLimit, type RateLimitVerdict } from "@baumy/db/rate-limit";
import { auditEvents } from "@baumy/db/schema";
import { isTestMode } from "@/lib/test-mode";

// Kiosk PIN attestation (SPEC §6.2). The acting member's PIN travels with
// each attested kiosk request and is checked in that request, by
// `requireAttested` through runAction. Nothing is stored, so the next person
// at the kiosk cannot inherit it.
//
// Every attempt is counted BEFORE the PIN is checked, so concurrent guesses
// cannot slip past a limit; a correct PIN then gives its attempt back, so
// only failures use the limits up:
//
//   - 5 per 15 minutes per device and member: the 6th wrong PIN in a window
//     is refused without being checked;
//   - 10 per 24h per member, on any device: the 10th failure locks the PIN
//     (`members.kiosk_pin_locked_at`) and writes an audit row, in one
//     transaction. The member unlocks it by setting a new PIN from their own
//     session (`set_kiosk_pin`), which also clears both counters.
//
// The lock's audit row is the one audit write outside `execute`: it happens
// inside runAction's attestation step, and it must commit even though the
// request it belongs to is refused.
//
// A counter that cannot be stored fails CLOSED: no PIN is accepted while the
// database cannot count the attempt.

export interface PinCheck {
  householdId: string;
  deviceId: string;
  memberId: string;
  pin: string;
  now: Date;
}

export type PinFailureReason =
  /** The PIN is not the member's. */
  | "wrong"
  /** The member has no kiosk PIN (or is no longer a member). */
  | "no_pin"
  /** Locked after 10 failures; `justLocked` when this attempt locked it. */
  | "locked"
  /** The 15-minute limit for this device and member is used up. */
  | "rate_limited"
  /** The attempt could not be counted, so the PIN was not checked. */
  | "unavailable";

export type PinVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: PinFailureReason;
      retryAfterSeconds?: number;
      justLocked?: boolean;
    };

/** Checks one attempt at `pin` as this member's kiosk PIN, right now. */
export type PinVerifier = (check: PinCheck) => Promise<PinVerdict>;

export interface PinVerifierDeps {
  findState: (
    householdId: string,
    memberId: string,
  ) => Promise<KioskPinState | null>;
  consume: (input: {
    key: string;
    limit: number;
    windowMs: number;
    now: Date;
  }) => Promise<RateLimitVerdict | null>;
  refund: (key: string) => Promise<void>;
  matches: (pin: string, hash: string) => Promise<boolean>;
  /** Sets the lock and, if this call set it, writes the audit row. */
  lock: (check: PinCheck) => Promise<void>;
}

/**
 * The counters use the database's clock, as every other rate limit does,
 * except in E2E test mode, where they follow the movable test clock.
 */
function consumeWithClock(input: {
  key: string;
  limit: number;
  windowMs: number;
  now: Date;
}): Promise<RateLimitVerdict | null> {
  const { now, ...rest } = input;
  return consumeRateLimit(isTestMode() ? { ...rest, now } : rest);
}

async function lockAndAudit(check: PinCheck): Promise<void> {
  await withTransaction(async (tx) => {
    const db = tx as unknown as Queryable;
    if (!(await lockKioskPin(db, check.memberId, check.now))) return;
    await db.insert(auditEvents).values({
      actorMemberId: check.memberId,
      source: "kiosk",
      action: "kiosk_pin_locked",
      entity: "member",
      entityId: check.memberId,
      payload: { deviceId: check.deviceId, failures: KIOSK_PIN_DAY_LIMIT },
      at: check.now,
    });
  });
}

export const defaultPinVerifierDeps: PinVerifierDeps = {
  findState: findKioskPinState,
  consume: consumeWithClock,
  refund: refundKioskPinAttempt,
  matches: checkPinHash,
  lock: lockAndAudit,
};

export function createKioskPinVerifier(
  deps: PinVerifierDeps = defaultPinVerifierDeps,
): PinVerifier {
  return async (check) => {
    const state = await deps.findState(check.householdId, check.memberId);
    if (!state?.pinHash) return { ok: false, reason: "no_pin" };
    if (state.lockedAt) return { ok: false, reason: "locked" };

    const keys = kioskPinKeys(check.deviceId, check.memberId);
    const short = await deps.consume({
      key: keys.short,
      limit: KIOSK_PIN_SHORT_LIMIT,
      windowMs: KIOSK_PIN_SHORT_WINDOW_MS,
      now: check.now,
    });
    if (!short) return { ok: false, reason: "unavailable" };
    if (!short.ok) {
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: short.retryAfterSeconds,
      };
    }

    // Counted with a limit one below the lock: "not ok" means this attempt
    // is at least the 10th in the window, so if it is wrong, it locks.
    const day = await deps.consume({
      key: keys.day,
      limit: KIOSK_PIN_DAY_LIMIT - 1,
      windowMs: KIOSK_PIN_DAY_WINDOW_MS,
      now: check.now,
    });
    if (!day) {
      await deps.refund(keys.short);
      return { ok: false, reason: "unavailable" };
    }

    if (await deps.matches(check.pin, state.pinHash)) {
      await deps.refund(keys.short);
      await deps.refund(keys.day);
      return { ok: true };
    }
    if (!day.ok) {
      await deps.lock(check);
      return { ok: false, reason: "locked", justLocked: true };
    }
    return { ok: false, reason: "wrong" };
  };
}

/** The verifier runAction uses. */
export const verifyKioskPin: PinVerifier = createKioskPinVerifier();
