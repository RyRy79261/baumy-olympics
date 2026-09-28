// What an account may do before anyone has proven its email address.
// Ported from camp-404 `packages/auth/src/email-proof.ts` (issue #79).
//
// Sign-up is open, and the address is not confirmed at sign-up. So an
// unconfirmed account may have been opened by someone who is NOT the owner of
// the address: sign up with a housemate's (or a FOUNDER_EMAILS) address before
// they ever do, and wait. Better Auth guards the Google half of that pre-account
// takeover itself (`requireLocalEmailVerified`, see config.ts). This plugin
// guards the rest:
//
// 1. No passkey and no two-factor until the address is confirmed. Either one
//    would outlive the owner's password reset: the reset revokes sessions but
//    leaves passkeys and the TOTP secret in place, so a squatter's passkey
//    would still sign in, and a squatter's TOTP would lock the owner out.
// 2. A valid reset link for an unconfirmed account clears the passkeys and
//    two-factor enrolled on it. Whoever holds the link holds the inbox, which
//    is the one thing the enroller never proved. (Enrolments made before rule
//    1 existed are why this is still needed.)
// 3. A verification link never skips two-factor. With
//    `autoSignInAfterVerification`, Better Auth's /verify-email opens a brand
//    new session for a browser that had none, and the twoFactor plugin only
//    challenges /sign-in/*. So for an account with two-factor on, the fresh
//    session is taken back: the address is confirmed, and the member signs in
//    the normal way, code and all. A browser already signed in to that
//    account keeps its session (Better Auth only refreshes its cookie).

import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { DEVICE_SIGNED_OUT } from "./env";

/** The endpoints that enrol a passkey or start two-factor. */
export const ENROLMENT_PATHS: ReadonlySet<string> = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/two-factor/enable",
]);

/** What a refused enrolment says; the security page shows it in the card. */
export const CONFIRM_EMAIL_FIRST =
  "Confirm your email first. Passkeys and two-factor are for an address you've proven is yours.";

/**
 * The endpoints that add or change a second way in (issue #79). Better Auth
 * checks their session through the signed cookie cache, which keeps working
 * for up to 5 minutes after the session is revoked; these ask the database.
 */
export const LIVE_SESSION_PATHS: ReadonlySet<string> = new Set([
  ...ENROLMENT_PATHS,
  "/two-factor/get-totp-uri",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/generate-backup-codes",
  "/two-factor/disable",
  // Starting "Link Google": the callback trusts the link it carries.
  "/link-social",
]);

export { DEVICE_SIGNED_OUT };

export function emailProofGuards() {
  return {
    id: "baumy-email-proof",
    hooks: {
      before: [
        {
          matcher: (ctx) => LIVE_SESSION_PATHS.has(String(ctx.path)),
          handler: createAuthMiddleware(async (ctx) => {
            // No session (a sign-in's two-factor step, or nobody): the
            // endpoint decides for itself.
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const stored = await ctx.context.internalAdapter.findSession(
              session.session.token,
            );
            if (stored && stored.session.expiresAt > new Date()) return;
            throw new APIError("UNAUTHORIZED", {
              code: "SESSION_REVOKED",
              message: DEVICE_SIGNED_OUT,
            });
          }),
        },
        {
          matcher: (ctx) => ENROLMENT_PATHS.has(String(ctx.path)),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            // No session: the endpoint answers 401 itself.
            if (!session || session.user.emailVerified) return;
            // The signed cookie cache can trail a confirmation by a few
            // minutes, so ask the database before refusing.
            const fresh = await ctx.context.internalAdapter.findUserById(
              session.user.id,
            );
            if (fresh?.emailVerified) return;
            throw new APIError("FORBIDDEN", {
              code: "EMAIL_NOT_VERIFIED",
              message: CONFIRM_EMAIL_FIRST,
            });
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/reset-password",
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as {
              token?: unknown;
              newPassword?: unknown;
            };
            const query = (ctx.query ?? {}) as { token?: unknown };
            const token =
              typeof body.token === "string" && body.token
                ? body.token
                : typeof query.token === "string"
                  ? query.token
                  : "";
            if (!token || typeof body.newPassword !== "string") return;
            // A reset the endpoint is about to refuse clears nothing.
            const rule = ctx.context.password.config;
            if (
              body.newPassword.length < rule.minPasswordLength ||
              body.newPassword.length > rule.maxPasswordLength
            ) {
              return;
            }
            const verification =
              await ctx.context.internalAdapter.findVerificationValue(
                `reset-password:${token}`,
              );
            if (!verification || verification.expiresAt < new Date()) return;
            const userId = verification.value;
            const user = await ctx.context.internalAdapter.findUserById(userId);
            if (!user || user.emailVerified) return;
            await ctx.context.adapter.deleteMany({
              model: "passkey",
              where: [{ field: "userId", value: userId }],
            });
            await ctx.context.adapter.deleteMany({
              model: "twoFactor",
              where: [{ field: "userId", value: userId }],
            });
            await ctx.context.internalAdapter.updateUser(userId, {
              twoFactorEnabled: false,
            });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/verify-email",
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession as {
              session: { token: string };
              user: { twoFactorEnabled?: boolean | null };
            } | null;
            if (!created || created.user.twoFactorEnabled !== true) return;
            // The session the request came in with, if any. When it is the
            // one Better Auth just refreshed, nothing was skipped.
            const current = await getSessionFromCtx(ctx);
            if (current && current.session.token === created.session.token) {
              return;
            }
            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(
              created.session.token,
            );
            ctx.context.setNewSession(null);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
