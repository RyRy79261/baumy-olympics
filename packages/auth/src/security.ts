// Passkeys, two-factor and the last-used sign-in hint (issue #79), ported
// from camp-404 `packages/auth/src/config.ts`. Kept in one place, and added
// to config.ts's plugin list as ONE spread, so other sign-in plugins can sit
// beside it without touching these.
//
// None of them is ever the ONLY way in: a password or Google stays, and the
// Security page refuses to remove the last way in, so a lost phone or passkey
// is never a dead end (recovery: the password plus a backup code).

import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { lastLoginMethod } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { emailProofGuards } from "./email-proof";
import {
  AUTH_RP_NAME,
  LAST_LOGIN_METHOD_COOKIE,
  resolvePasskeyScope,
  type AuthEnv,
} from "./env";

export { LAST_LOGIN_METHOD_COOKIE };

/** What a passkey request answers when passkeys are off on this deployment. */
export const PASSKEYS_OFF =
  "Passkeys aren't set up on this site yet. Sign in with your password or Google.";

/**
 * Refuses every /passkey/* endpoint while passkeys are off
 * (resolvePasskeyScope is null): fail closed rather than bind a passkey to a
 * host nobody chose.
 */
export function passkeysOff() {
  return {
    id: "baumy-passkeys-off",
    hooks: {
      before: [
        {
          matcher: (ctx) => String(ctx.path).startsWith("/passkey/"),
          handler: createAuthMiddleware(async () => {
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "PASSKEYS_NOT_CONFIGURED",
              message: PASSKEYS_OFF,
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

/**
 * Better Auth endpoints switched off (config.ts `disabledPaths`) because an
 * audited action does the same job with a guard the endpoint lacks
 * (apps/web/lib/actions/account-security.ts): removing or renaming a passkey
 * and unlinking a provider (the last-way-in check), and signing sessions out
 * (the signed-out-device check and forgetting trusted devices). They answer
 * 404.
 */
export const ACCOUNT_SECURITY_DISABLED_PATHS = [
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
  "/unlink-account",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
] as const;

/** The `verification` rows the twoFactor plugin keeps for trusted devices. */
export const TRUSTED_DEVICE_PREFIX = "trust-device-";

/**
 * A changed password forgets every device trusted for two-factor (Better
 * Auth 1.6.25 keeps that trust for 30 days, and a trusted browser skips the
 * code with just the password). Changing the password also signs the other
 * devices out (the Security page asks for that), so a stolen laptop needs
 * the new password AND a code.
 */
export function forgetTrustOnPasswordChange() {
  return {
    id: "baumy-trusted-devices",
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/change-password",
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            const userId = ctx.context.session?.user.id;
            if (!userId) return;
            await ctx.context.adapter.deleteMany({
              model: "verification",
              where: [
                { field: "value", value: userId },
                {
                  field: "identifier",
                  operator: "starts_with",
                  value: TRUSTED_DEVICE_PREFIX,
                },
              ],
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

/** The two-factor step finishes a PASSWORD sign-in (Google is not asked). */
const SECOND_STEP_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

/** The account-security plugins for an env, in the order they must run. */
export function accountSecurityPlugins(env: AuthEnv) {
  const scope = resolvePasskeyScope(env);
  return [
    twoFactor({
      issuer: AUTH_RP_NAME,
      // The raw option stores backup codes in plain text. Encrypt them.
      backupCodeOptions: { storeBackupCodes: "encrypted" },
      // A Google-only or passkey-only member may still add a second factor.
      allowPasswordless: true,
    }),
    passkey({
      rpName: AUTH_RP_NAME,
      ...(scope?.rpID ? { rpID: scope.rpID } : {}),
      ...(scope?.origin ? { origin: scope.origin } : {}),
      // Discoverable credentials and user verification: one tap, no email to
      // type, on a phone or the laptop's fingerprint reader.
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    }),
    lastLoginMethod({
      cookieName: LAST_LOGIN_METHOD_COOKIE,
      // With two-factor on, the session is made by the code step, not by
      // /sign-in/email, so that step counts as the email sign-in it finishes.
      customResolveMethod: (ctx) =>
        SECOND_STEP_PATHS.has(String(ctx.path)) ? "email" : null,
    }),
    // Before the email-proof guards, so "off" is the answer whoever asks.
    ...(scope === null ? [passkeysOff()] : []),
    // What an unconfirmed account may not do: enrol a passkey or two-factor,
    // keep them once the owner resets, or skip two-factor through a link.
    emailProofGuards(),
    forgetTrustOnPasswordChange(),
  ];
}
