import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  __setDbOverride,
  schema,
  type Database,
  type PooledDatabase,
  type Queryable,
} from "@baumy/db";
import { grantStepUp } from "@baumy/db/step-ups";
import { createAuth, type Auth } from "../config";
import { PASSWORD_MIN_LENGTH } from "../password";
import { STEP_UP_REQUIRED, STEP_UP_TOTP_PATH } from "../step-up";
import { totpFromUri } from "./_totp";

// "Confirm it's you" inside Better Auth (issue #135, the critic's review of
// PR #139): a real sign-in opens the session's window, a session's age does
// not, and Better Auth's own security endpoints need an open window. Against
// the real instance and Postgres (PGlite), through `auth.handler`, as a
// browser (or a thief holding a stolen cookie) would call it.

const MIGRATIONS = fileURLToPath(
  new URL("../../../db/migrations", import.meta.url),
);
const ORIGIN = "http://localhost:3000";
const PASSWORD = "guarded-passphrase".padEnd(PASSWORD_MIN_LENGTH, "x");

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let auth: Auth;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  __setDbOverride({
    http: db as unknown as Database,
    pooled: {
      db: db as unknown as PooledDatabase["db"],
      pool: { end: async () => {} } as unknown as PooledDatabase["pool"],
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  auth = createAuth({ BETTER_AUTH_URL: ORIGIN, E2E_TEST_MODE: "1" });
}, 60_000);

afterAll(async () => {
  __setDbOverride(null);
  await client.close();
  vi.restoreAllMocks();
});

/** A cookie jar: the Set-Cookie of `res` over `prior`, cleared ones dropped. */
function jar(res: Response, prior = ""): string {
  const cookies = new Map<string, string>();
  for (const pair of prior.split("; ").filter(Boolean)) {
    const [name, ...rest] = pair.split("=");
    cookies.set(name!, rest.join("="));
  }
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, ...rest] = pair!.split("=");
    const value = rest.join("=");
    if (value && !/max-age=0/i.test(line)) cookies.set(name!, value);
    else cookies.delete(name!);
  }
  return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
}

function call(path: string, cookie = "", body?: unknown) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

let seq = 0;
/** A new account with a confirmed address, signed in by its sign-up. */
async function account() {
  seq += 1;
  const email = `guarded${seq}@example.com`;
  const res = await call("/sign-up/email", "", {
    email,
    password: PASSWORD,
    name: "Guarded",
  });
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, user.id));
  // The cookie cache would still say "unconfirmed": read the database.
  const cookie = jar(res)
    .split("; ")
    .filter((c) => !c.startsWith("baumy.session_data="))
    .join("; ");
  return { email, userId: user.id, cookie };
}

/** The account's sessions, newest last. */
async function sessionsOf(userId: string) {
  return db
    .select()
    .from(schema.session)
    .where(eq(schema.session.userId, userId))
    .orderBy(schema.session.createdAt);
}

/** The window of `sessionId`, if one was ever opened (open or not). */
async function windowOf(sessionId: string) {
  const [row] = await db
    .select()
    .from(schema.stepUps)
    .where(eq(schema.stepUps.sessionId, sessionId));
  return row ?? null;
}

async function closeWindows(userId: string) {
  await db.delete(schema.stepUps).where(eq(schema.stepUps.userId, userId));
}

async function openWindow(sessionId: string, userId: string) {
  await grantStepUp(db as unknown as Queryable, {
    sessionId,
    userId,
    method: "password",
    now: new Date(),
  });
}

/** Drop the cached session cookie, so each request reads the database. */
const fresh = (cookie: string) =>
  cookie
    .split("; ")
    .filter((c) => !c.startsWith("baumy.session_data="))
    .join("; ");

/** Turn two-factor on; returns the cookie of the session it swaps in. */
async function enrol(cookie: string) {
  const enabled = await call("/two-factor/enable", cookie, {
    password: PASSWORD,
  });
  expect(enabled.status).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const verified = await call("/two-factor/verify-totp", cookie, {
    code: totpFromUri(totpURI),
  });
  expect(verified.status).toBe(200);
  return { totpURI, cookie: fresh(jar(verified, cookie)) };
}

describe("a real sign-in opens a window", () => {
  it("signing up and signing in with the password open one for that session", async () => {
    const { email, userId } = await account();
    const [up] = await sessionsOf(userId);
    expect(await windowOf(up!.id)).toMatchObject({ method: "password" });

    const res = await call("/sign-in/email", "", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    const sessions = await sessionsOf(userId);
    expect(sessions).toHaveLength(2);
    expect(await windowOf(sessions[1]!.id)).toMatchObject({
      method: "password",
    });
  });

  it("with two-factor on, the password step opens none and the code step opens one", async () => {
    const { email, userId, cookie } = await account();
    const { totpURI } = await enrol(cookie);
    const before = (await sessionsOf(userId)).length;

    const first = await call("/sign-in/email", "", {
      email,
      password: PASSWORD,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    expect(await sessionsOf(userId)).toHaveLength(before);

    const second = await call("/two-factor/verify-totp", jar(first), {
      code: totpFromUri(totpURI),
    });
    expect(second.status).toBe(200);
    const sessions = await sessionsOf(userId);
    expect(sessions).toHaveLength(before + 1);
    expect(await windowOf(sessions.at(-1)!.id)).toMatchObject({
      method: "totp",
    });
  });

  it("Sign in with Baumy opens one", async () => {
    const { userId } = await account();
    const made = await auth.api.signInApproved({
      body: { userId },
      headers: new Headers(),
    });
    expect(await windowOf(made.sessionId)).toMatchObject({ method: "baumy" });
  });
});

describe("a session's age proves nothing (the bypass in PR #139)", () => {
  it("the sessions two-factor swaps in get no window, so turning it off is refused", async () => {
    const { userId, cookie } = await account();
    const [signedUp] = await sessionsOf(userId);
    // Turning two-factor on is allowed: the sign-up opened a window.
    const on = await enrol(cookie);
    // Better Auth deleted the signed-up session and made this one.
    const sessions = await sessionsOf(userId);
    expect(sessions).toHaveLength(1);
    const swapped = sessions[0];
    expect(swapped!.id).not.toBe(signedUp!.id);
    expect(swapped!.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    // A brand-new session, made by the enrolment, with no window.
    expect(await windowOf(swapped!.id)).toBeNull();

    const off = await call("/two-factor/disable", on.cookie, {
      password: PASSWORD,
    });
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({
      code: "STEP_UP_REQUIRED",
      message: STEP_UP_REQUIRED,
    });
    const [still] = await db
      .select({ on: schema.user.twoFactorEnabled })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    expect(still!.on).toBe(true);

    // With a window (the member confirmed it), it turns off, and the session
    // that swaps in has no window either: it cannot turn it back on.
    await openWindow(swapped!.id, userId);
    const offNow = await call("/two-factor/disable", on.cookie, {
      password: PASSWORD,
    });
    expect(offNow.status).toBe(200);
    const after = fresh(jar(offNow, on.cookie));
    const latest = (await sessionsOf(userId)).at(-1)!;
    expect(latest.id).not.toBe(swapped!.id);
    expect(await windowOf(latest.id)).toBeNull();
    const again = await call("/two-factor/enable", after, {
      password: PASSWORD,
    });
    expect(again.status).toBe(403);
  });
});

describe("Better Auth's security endpoints need an open window", () => {
  it("registering a passkey and the two-factor endpoints are refused without one", async () => {
    const { userId, cookie } = await account();
    await closeWindows(userId);
    for (const [path, body] of [
      ["/passkey/generate-register-options", undefined],
      ["/passkey/verify-registration", { response: {} }],
      ["/two-factor/enable", { password: PASSWORD }],
      ["/two-factor/disable", { password: PASSWORD }],
      ["/two-factor/generate-backup-codes", { password: PASSWORD }],
      ["/two-factor/get-totp-uri", { password: PASSWORD }],
      ["/two-factor/verify-totp", { code: "123456" }],
    ] as const) {
      const res = await call(path, cookie, body);
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toMatchObject({
        code: "STEP_UP_REQUIRED",
      });
    }
    expect(await db.select().from(schema.twoFactor)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ userId })]),
    );

    // With a window, the same session may.
    const [mine] = await sessionsOf(userId);
    await openWindow(mine!.id, userId);
    const options = await call("/passkey/generate-register-options", cookie);
    expect(options.status).toBe(200);
  });

  it("registering a passkey also needs a sign-in under 10 minutes old", async () => {
    const { userId, cookie } = await account();
    const [mine] = await sessionsOf(userId);
    await db
      .update(schema.session)
      .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(schema.session.id, mine!.id));
    // The window is open; Better Auth's freshAge (600s) still refuses.
    await openWindow(mine!.id, userId);
    const res = await call("/passkey/generate-register-options", cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
  });
});

describe("verifyStepUpTotp", () => {
  it("returns the time step of a right code, and refuses a wrong one", async () => {
    const { cookie } = await account();
    const on = await enrol(cookie);
    const headers = new Headers({ cookie: on.cookie, origin: ORIGIN });
    const code = totpFromUri(on.totpURI);
    await expect(
      auth.api.verifyStepUpTotp({ body: { code }, headers }),
    ).resolves.toEqual({ step: Math.floor(Date.now() / 30_000) });
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(
      auth.api.verifyStepUpTotp({ body: { code: wrong }, headers }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses an account without finished two-factor", async () => {
    const { userId, cookie } = await account();
    const headers = new Headers({ cookie, origin: ORIGIN });
    await expect(
      auth.api.verifyStepUpTotp({ body: { code: "123456" }, headers }),
    ).rejects.toMatchObject({ statusCode: 401 });
    // Half an enrolment (no code verified yet) proves nothing either.
    const enabled = await call("/two-factor/enable", cookie, {
      password: PASSWORD,
    });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const [row] = await db
      .select({ verified: schema.twoFactor.verified })
      .from(schema.twoFactor)
      .where(and(eq(schema.twoFactor.userId, userId)));
    expect(row!.verified).toBe(false);
    await expect(
      auth.api.verifyStepUpTotp({
        body: { code: totpFromUri(totpURI) },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("is SERVER_ONLY and not reachable over HTTP", async () => {
    const { cookie } = await account();
    const res = await call(STEP_UP_TOTP_PATH, cookie, { code: "123456" });
    expect(res.status).toBe(404);
  });
});
