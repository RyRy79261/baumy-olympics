import { and, eq, gt, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { stepUps, twoFactor, user } from "./schema";

// "Confirm it's you" (issue #135, ADR 0007): the sudo window of one Better
// Auth session. `confirm_identity` grants it once the member has proven it is
// them; `requireRecentAuth` (apps/web/lib/auth/recent-auth.ts) reads it before
// a sensitive change. These functions take the caller's handle and write
// neither `audit_events` nor `action_requests`.

/** How long one confirmation lasts. */
export const STEP_UP_WINDOW_MS = 10 * 60_000;

/** The ways a member can confirm it is them. */
export const STEP_UP_METHODS = ["passkey", "totp", "baumy", "password"] as const;
export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

/**
 * Open (or extend) the window of `sessionId` until `now` plus
 * `STEP_UP_WINDOW_MS`. One row per session: a second confirmation replaces
 * the first.
 */
export async function grantStepUp(
  db: Queryable,
  input: {
    sessionId: string;
    userId: string;
    method: StepUpMethod;
    now: Date;
  },
): Promise<{ expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + STEP_UP_WINDOW_MS);
  await db
    .insert(stepUps)
    .values({
      sessionId: input.sessionId,
      userId: input.userId,
      method: input.method,
      confirmedAt: input.now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: stepUps.sessionId,
      set: {
        userId: input.userId,
        method: input.method,
        confirmedAt: input.now,
        expiresAt,
      },
    });
  return { expiresAt };
}

/**
 * When the window of `sessionId` closes, if it is open at `now` and the
 * session is `userId`'s; null otherwise.
 */
export async function findStepUp(
  db: Queryable,
  input: { sessionId: string; userId: string; now: Date },
): Promise<{ method: StepUpMethod; expiresAt: Date } | null> {
  const [row] = await db
    .select({ method: stepUps.method, expiresAt: stepUps.expiresAt })
    .from(stepUps)
    .where(
      and(
        eq(stepUps.sessionId, input.sessionId),
        eq(stepUps.userId, input.userId),
        gt(stepUps.expiresAt, input.now),
      ),
    )
    .limit(1);
  return row
    ? { method: row.method as StepUpMethod, expiresAt: row.expiresAt }
    : null;
}

/**
 * Whether the account has two-factor on with a verified secret: only then
 * does a code prove anything. Better Auth's verify-totp, called with a
 * session, would otherwise FINISH an enrolment (turning two-factor on), so the
 * code method is offered and accepted only when this is true.
 */
export async function hasVerifiedTotp(
  db: Queryable,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(user)
    .innerJoin(twoFactor, eq(twoFactor.userId, user.id))
    .where(
      and(
        eq(user.id, userId),
        eq(user.twoFactorEnabled, true),
        eq(twoFactor.verified, true),
      ),
    );
  return (row?.n ?? 0) > 0;
}
