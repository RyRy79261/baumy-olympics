// THE Better Auth configuration for Baumy Olympics (ADR 0001), self-hosted in
// the web app's own process against our own database.
//
// Ported from camp-404 `packages/auth/src/config.ts`, without two-factor,
// passkeys, the email-proof guards and the preview OAuth proxy (SPEC §11
// defers passkeys and 2FA), and with the `bearer()` plugin added so a future
// native shell can authenticate without cookies.
//
// Boots with no env: it constructs with a placeholder secret and the database
// placeholder URL, so `next build` and an env-less local start never throw.
// Whether a request may actually be served is `authMayServe` (env.ts): a
// Vercel deployment without the real secret fails closed.

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { createHttpDb, schema } from "@baumy/db";
import { approvalSignIn } from "./approval-sign-in";
import { sendAuthEmail } from "./email";
import {
  AUTH_COOKIE_PREFIX,
  AUTH_SESSION,
  authConfigWarnings,
  canDeliverAuthEmail,
  isGoogleConfigured,
  resolveBaseURL,
  resolveRateLimit,
  resolveTrustedOrigins,
  resolveUseSecureCookies,
  type AuthEnv,
} from "./env";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";

/**
 * Placeholder secret (at least 32 characters) so the instance constructs
 * without a real one. It is public, so anything signed with it is worthless;
 * `authMayServe` refuses to serve with it on any deployment.
 */
export const PLACEHOLDER_SECRET =
  "baumy-build-placeholder-better-auth-secret-000000000000";

/**
 * Assemble the betterAuth() options from an env bag. Pure apart from binding
 * the drizzle adapter to an HTTP database client (which opens no connection
 * until a query runs). Exported so tests can inspect what an env resolves to.
 */
export function buildAuthOptions(env: AuthEnv = process.env) {
  const baseURL = resolveBaseURL(env);
  const useSecureCookies = resolveUseSecureCookies(env);

  return {
    appName: "Baumy Olympics",
    secret: env.BETTER_AUTH_SECRET?.trim() || PLACEHOLDER_SECRET,
    ...(baseURL ? { baseURL } : {}),
    // Absolute origins only, never a wildcard.
    trustedOrigins: resolveTrustedOrigins(env),
    // No outbound telemetry from an auth stack that holds household data.
    telemetry: { enabled: false },

    // The HTTP driver has no transactions, so `transaction` stays at its
    // default (false): operations run one after another, the documented
    // serverless-safe path.
    database: drizzleAdapter(createHttpDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // The same numbers the sign-up and reset forms check.
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Invite codes (issue #9) are the front door, not email verification.
      requireEmailVerification: false,
      // A reset signs every device out. Better Auth defaults this to false.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail(env, { to: user.email, kind: "reset", url });
      },
      onPasswordReset: async ({ user }) => {
        await sendAuthEmail(env, {
          to: user.email,
          kind: "password-reset-completed",
        });
      },
    },

    emailVerification: {
      // Sent on sign-up only when there is a way to deliver it. It proves the
      // address, which is what lets a password account later link Google
      // (`requireLocalEmailVerified`, below). It never blocks sign-in.
      sendOnSignUp: canDeliverAuthEmail(env),
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(env, { to: user.email, kind: "verify", url });
      },
    },

    // CHANGE-EMAIL STAYS OFF (AGENTS.md "Security"). Turning it on mounts an
    // endpoint that confirms with the NEW address only, which turns a stolen
    // session into a permanent account takeover.
    user: {
      changeEmail: { enabled: false },
    },

    // Database sessions plus a short signed cookie cache. The numbers live in
    // env.ts so a screen that revokes sessions can state the real lag.
    session: {
      expiresIn: AUTH_SESSION.expiresInSeconds,
      updateAge: AUTH_SESSION.updateAgeSeconds,
      cookieCache: {
        enabled: true,
        maxAge: AUTH_SESSION.cookieCacheMaxAgeSeconds,
      },
    },

    // Google may link to an existing account with the same email. Linking
    // still refuses when the LOCAL account has not confirmed its email
    // (`requireLocalEmailVerified`, left at its default, true). Never relax
    // it (ADR 0001 "Traps"): otherwise someone could sign up with a member's
    // address and a password first, and the member's later Google sign-in
    // would join that account.
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },

    // An OAuth callback failure lands on our sign-in form with `?error=`,
    // instead of Better Auth's built-in error page, which is a dead end.
    onAPIError: { errorURL: "/auth/sign-in" },

    ...(isGoogleConfigured(env)
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID!.trim(),
              clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
            },
          },
        }
      : {}),

    // Counters in the database so every serverless instance shares them.
    // In-memory storage is per instance, which is no limit at all.
    rateLimit: {
      storage: "database",
      modelName: "rateLimit",
      ...resolveRateLimit(env),
    },

    plugins: [
      // `Authorization: Bearer <token>` for clients without cookies (SPEC
      // §6.2). Sign-in answers with a `set-auth-token` header holding the same
      // signed value as the session cookie. `requireSignature` refuses a bare
      // token: Better Auth stores `session.token` in plaintext, so without it
      // anyone who can read the table could present a row as a bearer token.
      bearer({ requireSignature: true }),
      // "Sign in with Baumy" (issue #80): a server-only endpoint that makes
      // the session once the member approved it in Telegram.
      approvalSignIn(),
    ],

    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      ...(useSecureCookies === undefined ? {} : { useSecureCookies }),
      // Lax, not strict: an OAuth round trip (Google, later the MCP connector)
      // is a cross-site top-level navigation, and a strict cookie would not
      // ride along.
      defaultCookieAttributes: { sameSite: "lax" },
    },
  } satisfies BetterAuthOptions;
}

/** Construct a Better Auth instance for an env, printing any warnings. */
export function createAuth(env: AuthEnv = process.env) {
  for (const warning of authConfigWarnings(env)) {
    console.warn(`[auth] ${warning}`);
  }
  return betterAuth(buildAuthOptions(env));
}

/** The concrete Better Auth instance type. */
export type Auth = ReturnType<typeof createAuth>;

const AUTH_KEY = Symbol.for("baumy.auth.instance");
type AuthGlobal = typeof globalThis & { [AUTH_KEY]?: Auth };

/**
 * The app's one instance, built on first use rather than at import, so
 * importing this package (for a type, or in a test) constructs nothing and
 * prints no warnings. Kept on globalThis because Next can load this module
 * once per route bundle.
 */
export function getAuth(): Auth {
  const g = globalThis as AuthGlobal;
  g[AUTH_KEY] ??= createAuth();
  return g[AUTH_KEY];
}
