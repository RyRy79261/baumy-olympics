// Pure environment resolution for the Better Auth config (ADR 0001).
//
// Ported from camp-404 `packages/auth/src/env.ts`, which is itself adapted from
// the AfrikaBurn contributors app. Baumy Olympics has no apex domain, so the
// apex rules and the preview OAuth proxy are gone. The passkey scope (issue
// #79) is the base URL's own host, or PASSKEY_RP_ID when that covers it.
//
// PURITY CONTRACT: no I/O, no better-auth import, no side effects. Everything
// here is a deterministic function of an env bag, so it is testable without a
// database or a running auth instance. config.ts consumes these.

/**
 * The subset of process.env the auth config reads. All optional: the app still
 * boots, and `next build` still runs, with none of them set.
 */
export interface AuthEnv {
  BETTER_AUTH_SECRET?: string | undefined;
  /** The absolute origin people use in production, e.g. https://baumy.example. */
  BETTER_AUTH_URL?: string | undefined;
  /**
   * Optional: the domain passkeys are bound to, e.g. `baumy.example` for an
   * app served on `olympics.baumy.example`. It must be the base URL's host or
   * a parent of it; anything else turns passkeys OFF (resolvePasskeyScope).
   * Unset, passkeys are bound to the base URL's own host.
   */
  PASSKEY_RP_ID?: string | undefined;
  /** Vercel's own hosts, without a protocol. */
  VERCEL_URL?: string | undefined;
  VERCEL_BRANCH_URL?: string | undefined;
  VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
  VERCEL_ENV?: string | undefined;
  /** An email provider is what makes a reset link possible. */
  RESEND_API_KEY?: string | undefined;
  RESEND_FROM_EMAIL?: string | undefined;
  /** Optional rate-limit tuning. UNSET IN PRODUCTION; see resolveRateLimit. */
  AUTH_RATE_LIMIT_WINDOW_SECONDS?: string | undefined;
  AUTH_RATE_LIMIT_MAX?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  NODE_ENV?: string | undefined;
  /**
   * Comma-separated emails that may join as an admin without an invite code,
   * once the address is verified (SPEC §6.2). How the first admin exists.
   */
  FOUNDER_EMAILS?: string | undefined;
  /** The e2e harness switch. The app refuses to boot with it on Vercel. */
  E2E_TEST_MODE?: string | undefined;
  /**
   * E2E only: auth emails are appended to this file instead of sent, so a
   * Playwright run can follow a reset link. Honoured only by
   * resolveAuthEmailCaptureFile.
   */
  AUTH_EMAIL_CAPTURE_FILE?: string | undefined;
}

/**
 * Session lifetime, in seconds (SPEC §6.2). Database sessions plus a short
 * signed cookie cache: fast reads without giving up server-side revocation.
 *
 * `cookieCacheMaxAgeSeconds` is also the revocation lag: a session signed out
 * or revoked elsewhere keeps working in a browser for up to this long, because
 * the check is a signature on a cookie rather than a database read. Any screen
 * that revokes sessions must state this number.
 */
export const AUTH_SESSION = {
  expiresInSeconds: 60 * 60 * 24 * 30, // 30 days
  updateAgeSeconds: 60 * 60 * 24, // refreshed at most once a day
  cookieCacheMaxAgeSeconds: 300, // 5 minutes
} as const;

/** Every Better Auth cookie is named `baumy.<name>`. */
export const AUTH_COOKIE_PREFIX = "baumy";

function trimmed(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  return v ? v : undefined;
}

/** True when the signing secret is set. Without it sessions are worthless. */
export function isAuthConfigured(env: AuthEnv): boolean {
  return Boolean(trimmed(env.BETTER_AUTH_SECRET));
}

/**
 * Whether auth may serve a request at all. On any Vercel deployment it needs a
 * real secret: the placeholder is in this public repository, so a cookie
 * signed with it can be forged by anyone. So a deployment without the secret
 * FAILS CLOSED (nobody is signed in, and the auth endpoints answer 503) rather
 * than accepting forged sessions. Off Vercel (local dev, CI, e2e) the
 * placeholder is allowed, because nothing there holds real accounts.
 */
export function authMayServe(env: AuthEnv): boolean {
  return isAuthConfigured(env) || !trimmed(env.VERCEL_ENV);
}

/** True when an email provider is fully configured (key AND sender). */
export function isEmailProviderConfigured(env: AuthEnv): boolean {
  return Boolean(trimmed(env.RESEND_API_KEY) && trimmed(env.RESEND_FROM_EMAIL));
}

/**
 * The file auth emails are captured to instead of sent, or undefined.
 *
 * Honoured ONLY under the e2e harness (E2E_TEST_MODE=1) and ONLY off Vercel
 * (VERCEL_ENV unset or blank). Anywhere else it is refused whatever the path
 * says: a file of working reset links on a deployment would be a side door
 * into every account. The app also refuses to boot with E2E_TEST_MODE on
 * Vercel (apps/web/lib/test-mode.ts), so this is the second of two locks.
 */
export function resolveAuthEmailCaptureFile(env: AuthEnv): string | undefined {
  if (env.E2E_TEST_MODE !== "1") return undefined;
  if (trimmed(env.VERCEL_ENV)) return undefined;
  return trimmed(env.AUTH_EMAIL_CAPTURE_FILE);
}

/**
 * True when an auth email can reach someone: a real provider, or the e2e
 * capture file. What decides whether password reset is offered.
 */
export function canDeliverAuthEmail(env: AuthEnv): boolean {
  return (
    isEmailProviderConfigured(env) ||
    resolveAuthEmailCaptureFile(env) !== undefined
  );
}

/** True when Google sign-in is fully configured (id AND secret). */
export function isGoogleConfigured(env: AuthEnv): boolean {
  return Boolean(
    trimmed(env.GOOGLE_CLIENT_ID) && trimmed(env.GOOGLE_CLIENT_SECRET),
  );
}

function https(host: string | undefined): string | undefined {
  const h = trimmed(host);
  return h ? `https://${h}` : undefined;
}

/**
 * The base URL auth links and OAuth callbacks are built from.
 *
 * The explicit value first. Then, in production, Vercel's production host, NOT
 * `VERCEL_URL`, which in production is the one-off deployment host that nobody
 * visits: a reset link built from it would land where the member has no
 * session, and Google would refuse a callback it was never told about. A
 * preview uses its own deployment host. Undefined locally, so Better Auth
 * reads the host from the request.
 */
export function resolveBaseURL(env: AuthEnv): string | undefined {
  const explicit = trimmed(env.BETTER_AUTH_URL);
  if (explicit) return explicit;
  if (env.VERCEL_ENV === "production") {
    return https(env.VERCEL_PROJECT_PRODUCTION_URL) ?? https(env.VERCEL_URL);
  }
  return https(env.VERCEL_URL);
}

/**
 * Whether cookies get the `Secure` flag, keyed off the origin we are served on
 * rather than NODE_ENV (AfrikaBurn's lesson: a production build served over
 * plain http, which is how the e2e harness serves the app, silently drops
 * `__Secure-` cookies). Undefined keeps Better Auth's default; only an
 * explicit http:// base URL turns it off.
 */
export function resolveUseSecureCookies(env: AuthEnv): boolean | undefined {
  const baseURL = resolveBaseURL(env);
  if (!baseURL) return undefined;
  return baseURL.startsWith("https://") ? undefined : false;
}

export interface RateLimitTuning {
  window?: number;
  max?: number;
  customRules?: Record<string, { window: number; max: number }>;
}

/**
 * The auth paths Better Auth (or a plugin) gives its own, stricter, built-in
 * limits: 3 per 10 s for sign-in, change-password and every two-factor step
 * (issue #79), 3 per minute for the emails.
 */
export const SENSITIVE_AUTH_PATHS = [
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/change-password",
  "/two-factor/*",
] as const;

/**
 * Optional rate-limit tuning, so the e2e harness can raise the ceiling without
 * anyone reaching for `enabled: false`. `{}` when unset keeps Better Auth's
 * own defaults. Ignored on any Vercel deployment, like the email capture file:
 * a stray value there would switch off brute-force protection on sign-in.
 */
export function resolveRateLimit(env: AuthEnv): RateLimitTuning {
  if (trimmed(env.VERCEL_ENV)) return {};
  const window = Number(env.AUTH_RATE_LIMIT_WINDOW_SECONDS);
  const max = Number(env.AUTH_RATE_LIMIT_MAX);
  const hasWindow = Number.isFinite(window) && window > 0;
  const hasMax = Number.isFinite(max) && max > 0;
  if (!hasWindow && !hasMax) return {};

  const out: RateLimitTuning = {};
  if (hasWindow) out.window = window;
  if (hasMax) {
    out.max = max;
    // Better Auth's STRICTER built-in rules for the sensitive paths win over
    // the global `max`, so raise them too.
    const rule = { window: hasWindow ? window : 60, max };
    out.customRules = Object.fromEntries(
      SENSITIVE_AUTH_PATHS.map((path) => [path, rule]),
    );
  }
  return out;
}

/**
 * The absolute origins auth accepts requests from: the base URL and every host
 * Vercel serves this deployment on. Absolute only, never a wildcard (a
 * wildcard callbackURL is a documented account-takeover class).
 */
export function resolveTrustedOrigins(env: AuthEnv): string[] {
  const origins = new Set<string>();
  const add = (url: string | undefined) => {
    if (!url) return;
    try {
      const { origin, protocol } = new URL(url);
      // Better Auth reads `*` in a trusted origin as a wildcard pattern, and
      // a host with one is never a real deployment, so it is dropped.
      if (
        (protocol === "http:" || protocol === "https:") &&
        !origin.includes("*")
      ) {
        origins.add(origin);
      }
    } catch {
      /* ignore an unparseable value */
    }
  };
  add(resolveBaseURL(env));
  add(trimmed(env.BETTER_AUTH_URL));
  add(https(env.VERCEL_URL));
  add(https(env.VERCEL_BRANCH_URL));
  add(https(env.VERCEL_PROJECT_PRODUCTION_URL));
  return [...origins];
}

/** The name an authenticator app and a passkey prompt show for the account. */
export const AUTH_RP_NAME = "Baumy Olympics";

/**
 * The cookie that remembers how this browser last signed in ("email",
 * "google" or "passkey"), so the sign-in page can say "Last used" (issue
 * #79). Not httpOnly (Better Auth's lastLoginMethod plugin sets it so a page
 * may read it) and not a secret.
 */
export const LAST_LOGIN_METHOD_COOKIE = "baumy.last_login_method";

/**
 * The cookies the account-security plugins set (issue #79), as Better Auth
 * names them before the `baumy.` prefix, with the lifetimes security.ts
 * configures. The privacy page names them from here.
 */
export const SECURITY_COOKIES = {
  /** How this browser last signed in (lastLoginMethod). */
  lastLoginMethodMaxAgeSeconds: 60 * 60 * 24 * 30,
  /** Between a correct password and the two-factor code. */
  twoFactorChallenge: "two_factor",
  twoFactorChallengeMaxAgeSeconds: 60 * 10,
  /** "Trust this device for 30 days" after a two-factor code. */
  trustDevice: "trust_device",
  trustDeviceMaxAgeSeconds: 60 * 60 * 24 * 30,
  /** The one-time challenge of a passkey ceremony. */
  passkeyChallenge: "passkey_challenge",
  passkeyChallengeMaxAgeSeconds: 60 * 5,
} as const;

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Where passkeys work, or null when they are OFF (issue #79).
 *
 * The relying-party id is THE near-irreversible passkey decision: a passkey
 * is bound to it for life. It is PASSKEY_RP_ID when that is the base URL's
 * host or a parent domain of it, otherwise the base URL's own host. The
 * origins a ceremony is checked against are the trusted origins under that
 * id, never the request's own Origin header.
 *
 * FAILS CLOSED: a PASSKEY_RP_ID that does not cover the base URL, or a
 * deployment with no base URL at all, turns passkeys off rather than binding
 * them to a host nobody chose. Locally, with no base URL, `{}` leaves the
 * plugin's defaults (`localhost`, and the request's origin).
 */
export interface PasskeyScope {
  rpID?: string;
  origin?: string[];
}

export function resolvePasskeyScope(env: AuthEnv): PasskeyScope | null {
  const explicit = trimmed(env.PASSKEY_RP_ID)?.toLowerCase();
  const baseHost = hostOf(resolveBaseURL(env));
  if (!baseHost) {
    return explicit || trimmed(env.VERCEL_ENV) ? null : {};
  }
  if (explicit && !isUnder(baseHost, explicit)) return null;
  const rpID = explicit ?? baseHost;
  const origin = resolveTrustedOrigins(env).filter((o) => {
    const host = hostOf(o);
    return host !== undefined && isUnder(host, rpID);
  });
  return { rpID, origin };
}

/** Plain-words warnings for a misconfigured auth stack, printed at boot. */
export function authConfigWarnings(env: AuthEnv): string[] {
  const warnings: string[] = [];
  const isProd =
    env.VERCEL_ENV === "production" || env.NODE_ENV === "production";

  if (!isAuthConfigured(env)) {
    warnings.push(
      authMayServe(env)
        ? "BETTER_AUTH_SECRET is not set: signing with a public placeholder. " +
            "Fine for local work; never for a deployment."
        : "BETTER_AUTH_SECRET is not set on this deployment: sign-in is OFF " +
            "(fail closed) until it is.",
    );
  }
  if (isAuthConfigured(env) && !canDeliverAuthEmail(env)) {
    warnings.push(
      "No email provider (RESEND_API_KEY + RESEND_FROM_EMAIL): a forgotten " +
        "password cannot be reset, because the link has no way to arrive.",
    );
  }
  if (isProd && isAuthConfigured(env) && !trimmed(env.BETTER_AUTH_URL)) {
    warnings.push(
      "BETTER_AUTH_URL is not set: auth links use Vercel's production host. " +
        "Set it to the address people actually visit.",
    );
  }
  if (resolvePasskeyScope(env) === null) {
    warnings.push(
      trimmed(env.PASSKEY_RP_ID)
        ? "PASSKEY_RP_ID is not the site's host or a parent domain of it: " +
            "passkeys are OFF until it is."
        : "No base URL to bind passkeys to: passkeys are OFF. Set BETTER_AUTH_URL.",
    );
  }
  return warnings;
}

/**
 * The founder emails, trimmed and lowercased; empty when unset. Better Auth
 * stores emails lowercased, so a session's email compares directly.
 */
export function resolveFounderEmails(env: AuthEnv): ReadonlySet<string> {
  return new Set(
    (env.FOUNDER_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

/** Whether `email` is on the founder list. */
export function isFounderEmail(env: AuthEnv, email: string): boolean {
  return resolveFounderEmails(env).has(email.trim().toLowerCase());
}
