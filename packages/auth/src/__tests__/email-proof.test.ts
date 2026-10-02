import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { buildAuthOptions } from "../config";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { APIError } from "better-auth/api";
import { CONFIRM_EMAIL_FIRST, DEVICE_SIGNED_OUT } from "../email-proof";
import { SECURITY_COOKIES, type AuthEnv } from "../env";
import {
  LAST_LOGIN_METHOD_COOKIE,
  PASSKEYS_OFF,
  newWayInNotices,
} from "../security";
import type { StepUpStore } from "../step-up";
import { totpFromUri } from "./_totp";

// The account-security plugins (issue #79), driven through a real Better Auth
// instance: our exact options and plugins, with only the database swapped
// for Better Auth's in-memory adapter and the two mail senders swapped for a
// capture. Each case is an HTTP request to the auth handler, the way a
// browser (or an attacker) would send it. Ported from camp-404
// `packages/auth/src/__tests__/email-proof.test.ts`, plus two-factor end to
// end, passkeys switched off and the last-used hint.

const BASE = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let mail: { kind: "verify" | "reset"; url: string; token: string }[];

/**
 * The step-up windows (issue #135) beside the in-memory Better Auth tables:
 * a sign-in opens one for its session, as the database store does. The
 * step-up guards themselves are tested against Postgres in step-up.test.ts.
 */
let windows: Map<string, number>;
const memoryStepUps: StepUpStore = {
  isOpen: async ({ sessionId, now }) =>
    (windows.get(sessionId) ?? 0) > now.getTime(),
  grantIfLive: async ({ sessionId, now }) => {
    if (!db.session!.some((s) => s.id === sessionId)) return false;
    windows.set(sessionId, now.getTime() + 10 * 60_000);
    return true;
  },
};

function makeAuth(extra: AuthEnv = {}) {
  const options = buildAuthOptions(
    {
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
      BETTER_AUTH_URL: BASE,
      ...extra,
    },
    memoryStepUps,
  );
  return betterAuth({
    ...options,
    baseURL: BASE,
    database: memoryAdapter(db),
    emailAndPassword: {
      ...options.emailAndPassword,
      sendResetPassword: async ({ url, token }) => {
        mail.push({ kind: "reset", url, token });
      },
      onPasswordReset: async () => {},
    },
    emailVerification: {
      ...options.emailVerification,
      sendOnSignUp: false,
      sendVerificationEmail: async ({ url, token }) => {
        mail.push({ kind: "verify", url, token });
      },
    },
  });
}

let auth: ReturnType<typeof makeAuth>;

/** Cookie header from a response's Set-Cookie list, dropping cleared ones. */
function cookiesFrom(res: Response, prior = ""): string {
  const jar = new Map<string, string>();
  for (const pair of prior.split("; ").filter(Boolean)) {
    const [name, ...rest] = pair.split("=");
    jar.set(name!, rest.join("="));
  }
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, ...rest] = pair!.split("=");
    const value = rest.join("=");
    if (value && !/max-age=0/i.test(line)) jar.set(name!, value);
    else jar.delete(name!);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers({ origin: BASE });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function signUp(email: string) {
  const res = await call("/sign-up/email", {
    body: { email, password: PASSWORD, name: "Someone" },
  });
  expect(res.status).toBe(200);
  const user = db.user!.find((u) => u.email === email)!;
  return { cookie: cookiesFrom(res), userId: user.id as string };
}

function userRow(id: string): Row {
  return db.user!.find((u) => u.id === id)!;
}

function hasSessionCookie(res: Response): boolean {
  return res.headers
    .getSetCookie()
    .some(
      (line) =>
        line.startsWith("baumy.session_token=") &&
        !line.startsWith("baumy.session_token=;") &&
        !/max-age=0/i.test(line),
    );
}

beforeEach(() => {
  db = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
    twoFactor: [],
    passkey: [],
  };
  mail = [];
  windows = new Map();
  auth = makeAuth();
});

describe("enrolling a passkey or two-factor", () => {
  it("is refused while the email is unconfirmed", async () => {
    const { cookie } = await signUp("squatter@example.com");

    const twoFactor = await call("/two-factor/enable", {
      body: { password: PASSWORD },
      cookie,
    });
    expect(twoFactor.status).toBe(403);
    await expect(twoFactor.json()).resolves.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      message: CONFIRM_EMAIL_FIRST,
    });
    expect(db.twoFactor).toEqual([]);

    const passkey = await call("/passkey/generate-register-options", {
      cookie,
    });
    expect(passkey.status).toBe(403);
  });

  it("is allowed once the email is confirmed, even before the cookie cache catches up", async () => {
    const { cookie, userId } = await signUp("owner@example.com");
    // Confirmed in the database; the session cookie still says unconfirmed.
    userRow(userId).emailVerified = true;

    const twoFactor = await call("/two-factor/enable", {
      body: { password: PASSWORD },
      cookie,
    });
    expect(twoFactor.status).toBe(200);

    const passkey = await call("/passkey/generate-register-options", {
      cookie,
    });
    expect(passkey.status).toBe(200);
  });
});

describe("a password reset on an unconfirmed account", () => {
  function enrol(userId: string) {
    db.passkey!.push({
      id: "pk1",
      userId,
      publicKey: "k",
      credentialID: "c",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    });
    db.twoFactor!.push({
      id: "tf1",
      userId,
      secret: "s",
      backupCodes: "b",
      verified: true,
    });
    userRow(userId).twoFactorEnabled = true;
  }

  async function reset(email: string, newPassword = "a whole new passphrase") {
    const asked = await call("/request-password-reset", {
      body: { email, redirectTo: "/auth/reset-password" },
    });
    expect(asked.status).toBe(200);
    const link = mail.find((m) => m.kind === "reset")!;
    return call("/reset-password", {
      body: { token: link.token, newPassword },
    });
  }

  it("clears the passkeys and two-factor enrolled while nobody had proven the address", async () => {
    const { userId } = await signUp("owner@example.com");
    enrol(userId);

    const res = await reset("owner@example.com");
    expect(res.status).toBe(200);

    expect(db.passkey).toEqual([]);
    expect(db.twoFactor).toEqual([]);
    expect(userRow(userId).twoFactorEnabled).toBe(false);
  });

  it("keeps them on a confirmed account", async () => {
    const { userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;
    enrol(userId);

    expect((await reset("owner@example.com")).status).toBe(200);

    expect(db.passkey).toHaveLength(1);
    expect(db.twoFactor).toHaveLength(1);
    expect(userRow(userId).twoFactorEnabled).toBe(true);
  });

  it("keeps them when the reset itself is refused", async () => {
    const { userId } = await signUp("owner@example.com");
    enrol(userId);

    const res = await reset("owner@example.com", "short");
    expect(res.status).toBe(400);

    expect(db.passkey).toHaveLength(1);
    expect(db.twoFactor).toHaveLength(1);
  });
});

describe("a verification link", () => {
  async function linkFor(email: string): Promise<string> {
    // Unauthenticated, as anyone who knows the address can ask.
    const res = await call("/send-verification-email", {
      body: { email, callbackURL: "/" },
    });
    expect(res.status).toBe(200);
    return mail.find((m) => m.kind === "verify")!.url;
  }

  async function follow(url: string, cookie?: string) {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    return auth.handler(new Request(url, { headers, redirect: "manual" }));
  }

  it("never opens a session that skips two-factor", async () => {
    const { userId } = await signUp("owner@example.com");
    userRow(userId).twoFactorEnabled = true;
    db.session = [];
    const url = await linkFor("owner@example.com");

    const res = await follow(url);

    expect(res.status).toBe(302);
    expect(userRow(userId).emailVerified).toBe(true);
    expect(hasSessionCookie(res)).toBe(false);
    expect(db.session).toEqual([]);
  });

  it("still signs in an account without two-factor", async () => {
    // The control: the same link for an account without the code does sign
    // in, so the case above fails for the reason it names.
    const { userId } = await signUp("owner@example.com");
    db.session = [];
    const url = await linkFor("owner@example.com");

    const res = await follow(url);

    expect(hasSessionCookie(res)).toBe(true);
    expect(db.session!.filter((s) => s.userId === userId)).toHaveLength(1);
  });

  it("keeps the session of a browser already signed in to that account", async () => {
    const signedUp = await signUp("owner@example.com");
    const { userId } = signedUp;
    userRow(userId).twoFactorEnabled = true;
    // Drop the cached copy of the session so the server reads the account as
    // it is now, two-factor on.
    const cookie = signedUp.cookie
      .split("; ")
      .filter((pair) => !pair.startsWith("baumy.session_data"))
      .join("; ");
    const url = await linkFor("owner@example.com");

    const res = await follow(url, cookie);

    expect(res.status).toBe(302);
    expect(db.session!.filter((s) => s.userId === userId)).toHaveLength(1);
    const after = await call("/get-session", {
      cookie: cookiesFrom(res, cookie),
    });
    await expect(after.json()).resolves.toMatchObject({
      user: { emailVerified: true },
    });
  });
});

describe("two-factor, end to end", () => {
  async function verifiedMember(email: string) {
    const signed = await signUp(email);
    userRow(signed.userId).emailVerified = true;
    return signed;
  }

  async function enable(cookie: string) {
    const res = await call("/two-factor/enable", {
      body: { password: PASSWORD },
      cookie,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const verify = await call("/two-factor/verify-totp", {
      body: { code: totpFromUri(data.totpURI) },
      cookie,
    });
    expect(verify.status).toBe(200);
    return data;
  }

  it("names the entry Baumy Olympics, stores the codes encrypted and turns on once a code verifies", async () => {
    const { cookie, userId } = await verifiedMember("owner@example.com");
    const started = await call("/two-factor/enable", {
      body: { password: PASSWORD },
      cookie,
    });
    const { totpURI, backupCodes } = (await started.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(decodeURIComponent(totpURI)).toContain("Baumy Olympics");
    expect(backupCodes.length).toBeGreaterThan(0);
    // Not on until a code from the app proves the secret was saved.
    expect(userRow(userId).twoFactorEnabled).not.toBe(true);
    const stored = JSON.stringify(db.twoFactor);
    expect(stored).not.toContain(backupCodes[0]!);

    const wrong = await call("/two-factor/verify-totp", {
      body: { code: "000000" === totpFromUri(totpURI) ? "111111" : "000000" },
      cookie,
    });
    expect(wrong.status).toBe(401);
    const right = await call("/two-factor/verify-totp", {
      body: { code: totpFromUri(totpURI) },
      cookie,
    });
    expect(right.status).toBe(200);
    expect(userRow(userId).twoFactorEnabled).toBe(true);
  });

  it("asks a password sign-in for the code, and a code or a backup code finishes it once", async () => {
    const { cookie } = await verifiedMember("owner@example.com");
    const { totpURI, backupCodes } = await enable(cookie);

    const signIn = () =>
      call("/sign-in/email", {
        body: { email: "owner@example.com", password: PASSWORD },
      });

    const first = await signIn();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      twoFactorRedirect: true,
    });
    expect(hasSessionCookie(first)).toBe(false);

    const challenge = cookiesFrom(first);
    const done = await call("/two-factor/verify-totp", {
      body: { code: totpFromUri(totpURI) },
      cookie: challenge,
    });
    expect(done.status).toBe(200);
    expect(hasSessionCookie(done)).toBe(true);
    // The code step finishes an email sign-in, so that is what is remembered.
    expect(
      done.headers
        .getSetCookie()
        .some((c) => c.startsWith(`${LAST_LOGIN_METHOD_COOKIE}=email`)),
    ).toBe(true);

    const second = await signIn();
    const backup = await call("/two-factor/verify-backup-code", {
      body: { code: backupCodes[0] },
      cookie: cookiesFrom(second),
    });
    expect(backup.status).toBe(200);
    expect(hasSessionCookie(backup)).toBe(true);

    const third = await signIn();
    const reused = await call("/two-factor/verify-backup-code", {
      body: { code: backupCodes[0] },
      cookie: cookiesFrom(third),
    });
    expect(reused.status).toBe(401);
    expect(hasSessionCookie(reused)).toBe(false);
  });

  it("remembers a plain password sign-in as email", async () => {
    await signUp("plain@example.com");
    const res = await call("/sign-in/email", {
      body: { email: "plain@example.com", password: PASSWORD },
    });
    expect(res.status).toBe(200);
    const hint = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${LAST_LOGIN_METHOD_COOKIE}=`));
    expect(hint).toMatch(/^baumy\.last_login_method=email;/);
    expect(hint).not.toMatch(/HttpOnly/i);
  });
});

describe("passkeys switched off", () => {
  it("refuses every passkey endpoint when there is no host to bind them to", async () => {
    // The control: with a base URL, the sign-in options are served.
    const on = await call("/passkey/generate-authenticate-options");
    expect(on.status).toBe(200);

    auth = makeAuth({ PASSKEY_RP_ID: "elsewhere.example" });
    const { cookie } = await signUp("owner@example.com");
    for (const [path, init] of [
      ["/passkey/generate-authenticate-options", {}],
      ["/passkey/verify-authentication", { body: {} }],
      ["/passkey/generate-register-options", { cookie }],
    ] as const) {
      const res = await call(path, init);
      expect(res.status, path).toBe(503);
      await expect(res.json()).resolves.toMatchObject({
        code: "PASSKEYS_NOT_CONFIGURED",
        message: PASSKEYS_OFF,
      });
    }
  });
});

describe("the guards' edges", () => {
  it("lets the endpoint answer an enrolment with no session itself", async () => {
    const res = await call("/two-factor/enable", {
      body: { password: PASSWORD },
    });
    expect(res.status).toBe(401);
    expect(db.twoFactor).toEqual([]);
  });

  it("lets a session that already says confirmed enrol without asking the database", async () => {
    const { userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;
    // A fresh sign-in, so the session itself says confirmed.
    const res = await call("/sign-in/email", {
      body: { email: "owner@example.com", password: PASSWORD },
    });
    const cookie = cookiesFrom(res);
    const enrol = await call("/two-factor/enable", {
      body: { password: PASSWORD },
      cookie,
    });
    expect(enrol.status).toBe(200);
  });

  it("clears nothing for a reset that names no token, an unknown one or an expired one", async () => {
    const { userId } = await signUp("owner@example.com");
    db.passkey!.push({
      id: "pk1",
      userId,
      publicKey: "k",
      credentialID: "c",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    });
    const newPassword = "a whole new passphrase";

    expect(
      (await call("/reset-password", { body: { newPassword } })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await call("/reset-password", { body: { token: "nope" } })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await call("/reset-password?token=nope", { body: { newPassword } }))
        .status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await call("/reset-password", {
          body: { token: "nope", newPassword: "x".repeat(500) },
        })
      ).status,
    ).toBe(400);

    await call("/request-password-reset", {
      body: { email: "owner@example.com", redirectTo: "/auth/reset-password" },
    });
    const link = mail.find((m) => m.kind === "reset")!;
    for (const v of db.verification!) v.expiresAt = new Date(0);
    expect(
      (
        await call("/reset-password", {
          body: { token: link.token, newPassword },
        })
      ).status,
    ).toBe(400);

    expect(db.passkey).toHaveLength(1);
  });

  it("opens no session for a verification link that does not verify", async () => {
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/verify-email?token=not-a-token`, {
        redirect: "manual",
      }),
    );
    expect(hasSessionCookie(res)).toBe(false);
    expect(db.session).toEqual([]);
  });
});

describe("passkeys on www.baumy.tech", () => {
  it("offers baumy.tech as the relying party for both registering and signing in", async () => {
    auth = makeAuth({
      BETTER_AUTH_URL: "https://www.baumy.tech",
      PASSKEY_RP_ID: "baumy.tech",
    });
    const { cookie, userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;

    const register = await call("/passkey/generate-register-options", {
      cookie,
    });
    expect(register.status).toBe(200);
    await expect(register.json()).resolves.toMatchObject({
      rp: { id: "baumy.tech", name: "Baumy Olympics" },
    });

    const signIn = await call("/passkey/generate-authenticate-options");
    expect(signIn.status).toBe(200);
    await expect(signIn.json()).resolves.toMatchObject({
      rpId: "baumy.tech",
    });
  });
});

describe("endpoints an audited action replaces", () => {
  it("answer 404, while the rest of the passkey plugin answers", async () => {
    const { cookie, userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;
    // Present before absent: the plugin is mounted and listing works.
    const list = await call("/passkey/list-user-passkeys", { cookie });
    expect(list.status).toBe(200);
    for (const [path, body] of [
      ["/passkey/delete-passkey", { id: "pk" }],
      ["/passkey/update-passkey", { id: "pk", name: "x" }],
      ["/unlink-account", { providerId: "google" }],
      ["/revoke-session", { token: "t" }],
      ["/revoke-sessions", {}],
      ["/revoke-other-sessions", {}],
    ] as const) {
      const res = await call(path, { body, cookie });
      expect(res.status, path).toBe(404);
    }
    expect(db.session!.filter((s) => s.userId === userId)).toHaveLength(1);
  });
});

describe("trusted devices and a changed password", () => {
  it("a changed password forgets every trusted device, so the code is asked again", async () => {
    const { cookie, userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;
    const started = await call("/two-factor/enable", {
      body: { password: PASSWORD },
      cookie,
    });
    const { totpURI } = (await started.json()) as { totpURI: string };
    const enrolled = await call("/two-factor/verify-totp", {
      body: { code: totpFromUri(totpURI) },
      cookie,
    });
    expect(enrolled.status).toBe(200);
    // Turning two-factor on refreshes this device's session cookie.
    const owner = cookiesFrom(enrolled, cookie);

    // Sign in on a device and trust it.
    const first = await call("/sign-in/email", {
      body: { email: "owner@example.com", password: PASSWORD },
    });
    const trusted = await call("/two-factor/verify-totp", {
      body: { code: totpFromUri(totpURI), trustDevice: true },
      cookie: cookiesFrom(first),
    });
    expect(trusted.status).toBe(200);
    const device = cookiesFrom(trusted, cookiesFrom(first));
    const trustRows = () =>
      db.verification!.filter((v) =>
        String(v.identifier).startsWith("trust-device-"),
      );
    expect(trustRows()).toHaveLength(1);

    // The control: while trusted, a password alone signs that device in.
    const skip = await call("/sign-in/email", {
      body: { email: "owner@example.com", password: PASSWORD },
      cookie: device,
    });
    await expect(skip.json()).resolves.not.toHaveProperty("twoFactorRedirect");

    const newPassword = "a whole new passphrase for this";
    const changed = await call("/change-password", {
      body: {
        currentPassword: PASSWORD,
        newPassword,
        revokeOtherSessions: true,
      },
      cookie: owner,
    });
    expect(changed.status).toBe(200);
    expect(trustRows()).toEqual([]);

    const again = await call("/sign-in/email", {
      body: { email: "owner@example.com", password: newPassword },
      cookie: device,
    });
    await expect(again.json()).resolves.toMatchObject({
      twoFactorRedirect: true,
    });
  });

  it("a refused password change forgets nothing", async () => {
    const { cookie, userId } = await signUp("owner@example.com");
    db.verification!.push({
      id: "t1",
      identifier: "trust-device-x",
      value: userId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await call("/change-password", {
      body: {
        currentPassword: "not it at all, no",
        newPassword: "whatever it is now",
      },
      cookie,
    });
    expect(res.status).toBe(400);
    expect(db.verification!.map((v) => v.id)).toContain("t1");
  });
});

describe("Google sign-in never links itself", () => {
  const GOOGLE = {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
  };

  function b64url(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }

  /** Google's token endpoint, answering with an id token for `email`. */
  function fakeGoogle(email: string, sub: string, emailVerified = true) {
    const idToken = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
      iss: "https://accounts.google.com",
      aud: "client-id",
      sub,
      email,
      email_verified: emailVerified,
      name: "Owner",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.sig`;
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : ((input as Request).url ?? String(input));
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "at",
            id_token: idToken,
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email profile",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    });
  }

  /** Start "Continue with Google" and come back from Google with a code. */
  async function continueWithGoogle(cookie = "") {
    const start = await call("/sign-in/social", {
      body: { provider: "google", callbackURL: "/" },
      cookie,
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const jar = cookiesFrom(start, cookie);
    const headers = new Headers({ cookie: jar });
    return auth.handler(
      new Request(
        `${BASE}/api/auth/callback/google?code=the-code&state=${encodeURIComponent(state)}`,
        { headers, redirect: "manual" },
      ),
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to join a password account with the same email, and adds no Google account", async () => {
    auth = makeAuth(GOOGLE);
    const { userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;
    fakeGoogle("owner@example.com", "google-sub-1");

    const res = await continueWithGoogle();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=account_not_linked");
    expect(hasSessionCookie(res)).toBe(false);
    expect(db.account!.filter((a) => a.providerId === "google")).toEqual([]);
  });

  it("still signs up a Google address with no account", async () => {
    auth = makeAuth(GOOGLE);
    fakeGoogle("new@example.com", "google-sub-2");
    const res = await continueWithGoogle();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("error=");
    expect(hasSessionCookie(res)).toBe(true);
    const user = db.user!.find((u) => u.email === "new@example.com")!;
    expect(user.emailVerified).toBe(true);
    expect(
      db.account!.filter(
        (a) => a.providerId === "google" && a.userId === user.id,
      ),
    ).toHaveLength(1);
  });

  /** "Link Google" on Settings, Security, and back from Google. */
  async function linkGoogle(cookie: string) {
    const start = await call("/link-social", {
      body: { provider: "google", callbackURL: "/settings/security" },
      cookie,
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    return auth.handler(
      new Request(
        `${BASE}/api/auth/callback/google?code=the-code&state=${encodeURIComponent(state)}`,
        {
          headers: new Headers({ cookie: cookiesFrom(start, cookie) }),
          redirect: "manual",
        },
      ),
    );
  }

  it("confirms the address when the owner links a Google account that verified it", async () => {
    auth = makeAuth(GOOGLE);
    const { cookie, userId } = await signUp("owner@example.com");
    expect(userRow(userId).emailVerified).toBe(false);
    fakeGoogle("owner@example.com", "google-sub-4");
    const res = await linkGoogle(cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("error=");
    expect(
      db.account!.filter(
        (a) => a.providerId === "google" && a.userId === userId,
      ),
    ).toHaveLength(1);
    expect(userRow(userId).emailVerified).toBe(true);
  });

  it("leaves the address unconfirmed when Google has not verified it", async () => {
    auth = makeAuth(GOOGLE);
    const { cookie, userId } = await signUp("owner@example.com");
    fakeGoogle("owner@example.com", "google-sub-5", false);
    await linkGoogle(cookie);
    expect(
      db.account!.filter(
        (a) => a.providerId === "google" && a.userId === userId,
      ),
    ).toHaveLength(1);
    expect(userRow(userId).emailVerified).toBe(false);
  });

  it("confirms nothing when the verified Google address is not the account's own", async () => {
    // Better Auth refuses such a link itself (email_doesn't_match), so the
    // hook is called directly: it is the second lock.
    const updateUser = vi.fn(async () => null);
    const ctx = {
      internalAdapter: {
        findUserById: async () => ({
          id: "u1",
          email: "owner@example.com",
          emailVerified: false,
        }),
        updateUser,
      },
    };
    const after = (
      newWayInNotices({}).init(ctx as never) as {
        options: {
          databaseHooks: {
            account: {
              create: { after: (a: Record<string, unknown>) => Promise<void> };
            };
          };
        };
      }
    ).options.databaseHooks.account.create.after;
    const b64 = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const token = (email: string) =>
      `${b64({ alg: "RS256" })}.${b64({ email, email_verified: true })}.sig`;

    await after({
      providerId: "google",
      userId: "u1",
      idToken: token("someone-else@example.com"),
    });
    expect(updateUser).not.toHaveBeenCalled();

    // The control: the account's own address is confirmed.
    await after({
      providerId: "google",
      userId: "u1",
      idToken: token("Owner@Example.com"),
    });
    expect(updateUser).toHaveBeenCalledWith("u1", { emailVerified: true });
  });

  it("signs in once the owner has linked Google", async () => {
    auth = makeAuth(GOOGLE);
    const { userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;
    // What "Link Google" (linkSocial) leaves behind.
    db.account!.push({
      id: "g1",
      accountId: "google-sub-3",
      providerId: "google",
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    fakeGoogle("owner@example.com", "google-sub-3");
    const res = await continueWithGoogle();
    expect(res.headers.get("location")).not.toContain("error=");
    expect(hasSessionCookie(res)).toBe(true);
  });
});

describe("the cookies the privacy page names", () => {
  /** `name -> Max-Age` for every cookie a response sets. */
  function setCookies(res: Response): Record<string, number | null> {
    return Object.fromEntries(
      res.headers.getSetCookie().map((line) => {
        const name = line.split("=")[0]!;
        const age = /max-age=(\d+)/i.exec(line)?.[1];
        return [name, age === undefined ? null : Number(age)];
      }),
    );
  }

  it("are the names and lifetimes in SECURITY_COOKIES", async () => {
    const { cookie, userId } = await signUp("owner@example.com");
    userRow(userId).emailVerified = true;
    const started = await call("/two-factor/enable", {
      body: { password: PASSWORD },
      cookie,
    });
    const { totpURI } = (await started.json()) as { totpURI: string };
    await call("/two-factor/verify-totp", {
      body: { code: totpFromUri(totpURI) },
      cookie,
    });

    const password = await call("/sign-in/email", {
      body: { email: "owner@example.com", password: PASSWORD },
    });
    expect(setCookies(password)).toMatchObject({
      [`baumy.${SECURITY_COOKIES.twoFactorChallenge}`]:
        SECURITY_COOKIES.twoFactorChallengeMaxAgeSeconds,
    });

    const code = await call("/two-factor/verify-totp", {
      body: { code: totpFromUri(totpURI), trustDevice: true },
      cookie: cookiesFrom(password),
    });
    expect(setCookies(code)).toMatchObject({
      [`baumy.${SECURITY_COOKIES.trustDevice}`]:
        SECURITY_COOKIES.trustDeviceMaxAgeSeconds,
      [LAST_LOGIN_METHOD_COOKIE]: SECURITY_COOKIES.lastLoginMethodMaxAgeSeconds,
    });

    const passkey = await call("/passkey/generate-authenticate-options");
    expect(setCookies(passkey)).toMatchObject({
      [`baumy.${SECURITY_COOKIES.passkeyChallenge}`]:
        SECURITY_COOKIES.passkeyChallengeMaxAgeSeconds,
    });
  });
});

describe("a device signed out elsewhere", () => {
  const CALLS: [string, { body?: unknown }][] = [
    ["/passkey/generate-register-options", {}],
    ["/passkey/verify-registration", { body: { response: {} } }],
    ["/two-factor/enable", { body: { password: PASSWORD } }],
    ["/two-factor/get-totp-uri", { body: { password: PASSWORD } }],
    ["/two-factor/verify-totp", { body: { code: "000000" } }],
    ["/two-factor/verify-backup-code", { body: { code: "abcde-fghij" } }],
    ["/two-factor/generate-backup-codes", { body: { password: PASSWORD } }],
    ["/two-factor/disable", { body: { password: PASSWORD } }],
    [
      "/link-social",
      { body: { provider: "google", callbackURL: "/settings/security" } },
    ],
  ];

  it("cannot add or change a passkey or two-factor with its cached cookie", async () => {
    for (const [path, init] of CALLS) {
      db.session = [];
      const { cookie, userId } = await signUp(
        `o${db.user!.length}@example.com`,
      );
      userRow(userId).emailVerified = true;
      // The control: with the session there, the guard lets it through.
      const live = await call(path, { ...init, cookie });
      expect(
        (
          (await live
            .clone()
            .json()
            .catch(() => ({}))) as { code?: string }
        ).code,
        path,
      ).not.toBe("SESSION_REVOKED");
      // Signed out elsewhere: the row is gone, the cached cookie is not.
      db.session = db.session!.filter((s) => s.userId !== userId);
      const res = await call(path, { ...init, cookie });
      expect(res.status, path).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        code: "SESSION_REVOKED",
        message: DEVICE_SIGNED_OUT,
      });
    }
    expect(db.passkey).toEqual([]);
  });
});

describe("the new-way-in email", () => {
  it("is sent after a passkey is registered, and not after a refused one", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baumy-passkey-mail-"));
    const file = path.join(dir, "mail.jsonl");
    try {
      const plugin = newWayInNotices({
        E2E_TEST_MODE: "1",
        AUTH_EMAIL_CAPTURE_FILE: file,
      });
      const hook = plugin.hooks.after[0]!;
      expect(
        hook.matcher({ path: "/passkey/verify-registration" } as never),
      ).toBe(true);
      expect(
        hook.matcher({ path: "/passkey/verify-authentication" } as never),
      ).toBe(false);
      const run = (returned: unknown) =>
        hook.handler({
          path: "/passkey/verify-registration",
          context: {
            returned,
            session: { user: { email: "owner@example.com" } },
          },
        } as never);
      await run(new APIError("BAD_REQUEST"));
      await expect(readFile(file, "utf8")).rejects.toThrow();
      await run({ id: "pk" });
      const lines = (await readFile(file, "utf8")).trim().split("\n");
      expect(lines.map((l) => JSON.parse(l))).toEqual([
        expect.objectContaining({
          to: "owner@example.com",
          kind: "passkey-added",
        }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
