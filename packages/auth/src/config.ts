// THE Better Auth configuration for Baumy Olympics (ADR 0001), self-hosted in
// the web app's own process against our own database.
//
// Ported from camp-404 `packages/auth/src/config.ts`, without the preview
// OAuth proxy, and with the `bearer()` plugin added so a future native shell
// can authenticate without cookies. Two-factor, passkeys, the email-proof
// guards and the last-used hint (issue #79) are `accountSecurityPlugins`
// (security.ts).
//
// Boots with no env: it constructs with a placeholder secret and the database
// placeholder URL, so `next build` and an env-less local start never throw.
// Whether a request may actually be served is `authMayServe` (env.ts): a
// Vercel deployment without the real secret fails closed.

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { createHttpDb, schema, type Queryable } from "@baumy/db";
import { forgetTrustedDevices } from "@baumy/db/account-security";
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
import {
  ACCOUNT_SECURITY_DISABLED_PATHS,
  accountSecurityPlugins,
} from "./security";

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
    // Endpoints an audited action replaces (issue #79, security.ts).
    disabledPaths: [...ACCOUNT_SECURITY_DISABLED_PATHS],

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
        twoFactor: schema.twoFactor,
        passkey: schema.passkey,
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
        // A reset also forgets every device trusted for two-factor (issue
        // #79): whoever reset the password must pass the code again.
        await forgetTrustedDevices(
          createHttpDb() as unknown as Queryable,
          user.id,
        );
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

    // Google joins an existing account ONLY when its owner presses "Link
    // Google" on Settings, Security (issue #79, `linkSocial`): a Google
    // sign-in never links itself (`disableImplicitLinking`), so "Unlink
    // Google" really stops Google signing in. A Google address with no
    // account still signs up as before. `requireLocalEmailVerified` stays at
    // its default, true; never relax it (ADR 0001 "Traps").
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        disableImplicitLinking: true,
      },
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
      // Two-factor, passkeys, the email-proof guards and the last-used
      // sign-in hint (issue #79).
      ...accountSecurityPlugins(env),
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
