import { findStepUp } from "@baumy/db/step-ups";
import type { ActionCtx } from "@/lib/actions/define";
import { fail } from "@/lib/actions/result";
import type { GateResult } from "./gates";

// "Confirm it's you" (issue #135, ADR 0007): GitHub's sudo mode for Baumy
// Olympics. A sensitive change (handing out a service token, changing a kiosk
// PIN, removing a way in) needs a session whose sudo window is open: a
// `step_ups` row, keyed by the session, written when
//
// - it signed in for real in the last 10 minutes (a password, Google, a
//   passkey, the sign-in code step or Sign in with Baumy: @baumy/auth's
//   step-up hooks), or
// - it confirmed it is them in the last 10 minutes, by any method the member
//   has (`confirm_identity`).
//
// A session's AGE never counts [CORRECTION 2026-10-02]: Better Auth makes new
// sessions on paths that prove nothing (turning two-factor on or off swaps
// in a session with a fresh `createdAt`), so trusting `createdAt` let a stolen
// session give itself sudo (the critic's review of PR #139).
//
// The window belongs to ONE session: another device, or another session of
// the same account, has none. The time is the action's `ctx.now`.
//
// Called from inside `execute` (the need can depend on the data: changing a
// PIN needs it, setting the first one does not), and before any lock is
// taken on the session row (service-tokens.ts explains why).

/** What a sensitive change answers until the member confirms it is them. */
export const CONFIRM_FIRST =
  "Confirm it's you first. Then do this within 10 minutes.";

/**
 * Until when this request's session may make sensitive changes, or null when
 * it may not now. Only a member's own session (cookie or bearer) can.
 */
export async function recentAuthUntil(ctx: ActionCtx): Promise<Date | null> {
  const { actor } = ctx;
  if (actor.kind !== "member" || !actor.sessionId) return null;
  const window = await findStepUp(ctx.db, {
    sessionId: actor.sessionId,
    userId: actor.userId,
    now: ctx.now,
  });
  return window?.expiresAt ?? null;
}

/** The step-up gate: OK within the window, else REAUTH_REQUIRED. */
export async function requireRecentAuth(ctx: ActionCtx): Promise<GateResult> {
  return (await recentAuthUntil(ctx))
    ? { ok: true }
    : fail("REAUTH_REQUIRED", CONFIRM_FIRST);
}
