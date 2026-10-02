import { findStepUp } from "@baumy/db/step-ups";
import type { ActionCtx } from "@/lib/actions/define";
import { fail } from "@/lib/actions/result";
import type { GateResult } from "./gates";

// "Confirm it's you" (issue #135, ADR 0007): GitHub's sudo mode for Baumy
// Olympics. A sensitive change (handing out a service token, changing a kiosk
// PIN, removing a way in) needs a session that has proven it is its member
// RECENTLY:
//
// - it signed in under 10 minutes ago (signing in is proof enough), or
// - it confirmed it is them under 10 minutes ago, by any method the member
//   has (a passkey, a two-factor code, a "Sign in with Baumy" tap or the
//   password: `confirm_identity`), which opened its sudo window
//   (`step_ups`, keyed by the session).
//
// The window belongs to ONE session: another device, or another session of
// the same account, has none. The time is the action's `ctx.now`.
//
// Called from inside `execute` (the need can depend on the data: changing a
// PIN needs it, setting the first one does not), and before any lock is
// taken on the session row (service-tokens.ts explains why).

/** A session this new counts as recently authenticated. */
export const FRESH_SESSION_MS = 10 * 60_000;

/** What a sensitive change answers until the member confirms it is them. */
export const CONFIRM_FIRST =
  "Confirm it's you first. Then do this within 10 minutes.";

/**
 * Until when this request's session counts as recently authenticated, or null
 * when it does not now. Only a member's own session (cookie or bearer) can.
 */
export async function recentAuthUntil(ctx: ActionCtx): Promise<Date | null> {
  const { actor } = ctx;
  if (actor.kind !== "member") return null;
  const now = ctx.now.getTime();
  const signedIn = Date.parse(actor.sessionCreatedAt);
  const fresh =
    Number.isFinite(signedIn) &&
    now >= signedIn &&
    now - signedIn < FRESH_SESSION_MS
      ? new Date(signedIn + FRESH_SESSION_MS)
      : null;
  const window = actor.sessionId
    ? await findStepUp(ctx.db, {
        sessionId: actor.sessionId,
        userId: actor.userId,
        now: ctx.now,
      })
    : null;
  if (!window) return fresh;
  if (!fresh) return window.expiresAt;
  return window.expiresAt > fresh ? window.expiresAt : fresh;
}

/** The step-up gate: OK within the window, else REAUTH_REQUIRED. */
export async function requireRecentAuth(ctx: ActionCtx): Promise<GateResult> {
  return (await recentAuthUntil(ctx))
    ? { ok: true }
    : fail("REAUTH_REQUIRED", CONFIRM_FIRST);
}
