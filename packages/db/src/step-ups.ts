import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { session, stepUpTotpSteps, stepUps, twoFactor, user } from "./schema";

// "Confirm it's you" (issue #135, ADR 0007): the sudo window of one Better
// Auth session. `confirm_identity` grants it once the member has proven it is
// them, and @baumy/auth's step-up hooks grant it on a real sign-in;
// `requireRecentAuth` (apps/web/lib/auth/recent-auth.ts) and the hooks read
// it before a sensitive change. These functions take the caller's handle and
// write neither `audit_events` nor `action_requests`.

/** How long one confirmation lasts. */
export const STEP_UP_WINDOW_MS = 10 * 60_000;

/** The proofs `confirm_identity` takes. */
export const STEP_UP_METHODS = [
  "passkey",
  "totp",
  "baumy",
  "password",
] as const;
export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

/**
 * How a window was opened: a proof above, or a sign-in (with Google, or with
 * a password and a backup code).
 */
export type StepUpGrant = StepUpMethod | "google" | "backup_code";

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
    method: StepUpGrant;
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
 * `grantStepUp` for a session that may already be gone (a password sign-in
 * that two-factor turned into a code step deletes the session it made). True
 * when the session exists and the window was opened.
 */
export async function grantStepUpIfLive(
  db: Queryable,
  input: {
    sessionId: string;
    userId: string;
    method: StepUpGrant;
    now: Date;
  },
): Promise<boolean> {
  const [live] = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
    )
    .limit(1);
  if (!live) return false;
  await grantStepUp(db, input);
  return true;
}

/**
 * When the window of `sessionId` closes, if it is open at `now` and the
 * session is `userId`'s; null otherwise.
 */
export async function findStepUp(
  db: Queryable,
  input: { sessionId: string; userId: string; now: Date },
): Promise<{ method: StepUpGrant; expiresAt: Date } | null> {
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
    ? { method: row.method as StepUpGrant, expiresAt: row.expiresAt }
    : null;
}

/**
 * Whether the account has two-factor on with a verified secret: only then
 * does a code prove anything, so the code method is offered and accepted
 * only when this is true.
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

/**
 * Use a TOTP time step for a step-up, once: true only when `step` is newer
 * than every step a step-up accepted for this account before. ONE statement
 * (an upsert whose update is guarded by `last_step < step`), so two requests
 * with the same code cannot both win.
 */
export async function claimTotpStep(
  db: Queryable,
  input: { userId: string; step: number; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(stepUpTotpSteps)
    .values({ userId: input.userId, lastStep: input.step, usedAt: input.now })
    .onConflictDoUpdate({
      target: stepUpTotpSteps.userId,
      set: { lastStep: input.step, usedAt: input.now },
      setWhere: lt(stepUpTotpSteps.lastStep, input.step),
    })
    .returning({ userId: stepUpTotpSteps.userId });
  return rows.length > 0;
}
