import { beforeEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { buildAuthOptions } from "../config";
import { CONFIRM_EMAIL_FIRST } from "../email-proof";
import type { AuthEnv } from "../env";
import { LAST_LOGIN_METHOD_COOKIE, PASSKEYS_OFF } from "../security";
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

function makeAuth(extra: AuthEnv = {}) {
  const options = buildAuthOptions({
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
    BETTER_AUTH_URL: BASE,
    ...extra,
  });
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
