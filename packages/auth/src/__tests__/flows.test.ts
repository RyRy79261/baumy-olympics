import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  __setDbOverride,
  schema,
  type Database,
  type PooledDatabase,
} from "@baumy/db";
import { createAuth, type Auth } from "../config";
import type { CapturedAuthEmail } from "../email";
import { PASSWORD_MIN_LENGTH } from "../password";
import { hashAccountPassword } from "../index";
import { totpFromUri } from "./_totp";

// The real Better Auth instance, built by createAuth, against real Postgres
// (PGlite, with the committed migrations replayed). Requests go through
// `auth.handler`, the same function the Next route calls, so these tests cover
// the wire behaviour the web app relies on: sign-up, sign-in, the enumeration-
// safe refusal, bearer tokens and a password reset from a captured email.

const MIGRATIONS = fileURLToPath(
  new URL("../../../db/migrations", import.meta.url),
);
const ORIGIN = "http://localhost:3000";

let client: PGlite;
let auth: Auth;
let mailDir: string;
let mailFile: string;

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  __setDbOverride({
    http: db as unknown as Database,
    pooled: {
      db: db as unknown as PooledDatabase["db"],
      pool: { end: async () => {} } as unknown as PooledDatabase["pool"],
    },
  });
  mailDir = await mkdtemp(path.join(tmpdir(), "baumy-auth-flow-"));
  mailFile = path.join(mailDir, "mail.jsonl");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  auth = createAuth({
    BETTER_AUTH_URL: ORIGIN,
    E2E_TEST_MODE: "1",
    AUTH_EMAIL_CAPTURE_FILE: mailFile,
  });
}, 60_000);

afterAll(async () => {
  __setDbOverride(null);
  await client.close();
  await rm(mailDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function post(pathname: string, body: unknown, headers: HeadersInit = {}) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

function getSession(headers: HeadersInit) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/get-session`, { headers }),
  );
}

async function capturedMail(): Promise<CapturedAuthEmail[]> {
  try {
    return (await readFile(mailFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CapturedAuthEmail);
  } catch {
    return [];
  }
}

const password = "correct-horse-battery".padEnd(PASSWORD_MIN_LENGTH, "x");
const email = "housemate@example.com";

describe("Better Auth against Postgres", () => {
  it("signs up, names the cookies baumy.* and returns a bearer token", async () => {
    const res = await post("/sign-up/email", { email, password, name: email });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("baumy.session_token=");
    expect(res.headers.get("set-auth-token")).toMatch(/\.[^.]+$/);
  });

  it("refuses a password shorter than the policy", async () => {
    const res = await post("/sign-up/email", {
      email: "short@example.com",
      password: "x".repeat(PASSWORD_MIN_LENGTH - 1),
      name: "short",
    });
    expect(res.status).toBe(400);
  });

  it("gives the same refusal for a wrong password and an unknown email", async () => {
    const wrong = await post("/sign-in/email", {
      email,
      password: "not-the-password-at-all",
    });
    const unknown = await post("/sign-in/email", {
      email: "nobody@example.com",
      password: "not-the-password-at-all",
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(wrong.status);
    const [a, b] = [await wrong.json(), await unknown.json()];
    expect(a).toEqual(b);
    expect(a).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
  });

  it("authenticates a signed bearer token and refuses the raw database token", async () => {
    const res = await post("/sign-in/email", { email, password });
    expect(res.status).toBe(200);
    const token = res.headers.get("set-auth-token");
    expect(token).toBeTruthy();

    const ok = await getSession({ authorization: `Bearer ${token}` });
    expect(
      ((await ok.json()) as { user?: { email: string } })?.user?.email,
    ).toBe(email);

    // What the `session` table holds, without the HMAC signature.
    const raw = decodeURIComponent(token!).split(".")[0];
    const rows = await client.query<{ n: number }>(
      "select count(*)::int as n from session where token = $1",
      [raw],
    );
    expect(rows.rows[0]?.n).toBe(1);
    const refused = await getSession({ authorization: `Bearer ${raw}` });
    expect(await refused.json()).toBeNull();

    const forged = await getSession({
      authorization: `Bearer ${raw}.forged-signature`,
    });
    expect(await forged.json()).toBeNull();
  });

  it("answers a reset request the same way whether or not the account exists", async () => {
    const known = await post("/request-password-reset", {
      email,
      redirectTo: "/auth/reset-password",
    });
    const unknown = await post("/request-password-reset", {
      email: "nobody@example.com",
      redirectTo: "/auth/reset-password",
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    const mail = await capturedMail();
    expect(mail.filter((m) => m.kind === "reset").map((m) => m.to)).toEqual([
      email,
    ]);
  });

  it("resets the password from the captured link and signs every device out", async () => {
    const signedIn = await post("/sign-in/email", { email, password });
    const before = signedIn.headers.get("set-auth-token")!;

    const link = (await capturedMail()).find((m) => m.kind === "reset")?.url;
    expect(link).toMatch(/\/api\/auth\/reset-password\//);
    const token = new URL(link!).pathname.split("/").at(-1)!;

    // A device trusted for two-factor, which the reset must forget.
    await client.query(
      `insert into verification (id, identifier, value, expires_at)
       select 'trust-1', 'trust-device-abc', id, now() + interval '1 day'
         from "user" where email = $1`,
      [email],
    );
    const trusted = async () =>
      (
        await client.query<{ n: number }>(
          "select count(*)::int as n from verification where identifier like 'trust-device-%'",
        )
      ).rows[0]?.n;
    expect(await trusted()).toBe(1);

    const newPassword = "a-brand-new-passphrase".padEnd(PASSWORD_MIN_LENGTH);
    const reset = await post("/reset-password", { newPassword, token });
    expect(reset.status).toBe(200);
    expect(await trusted()).toBe(0);

    const stale = await getSession({ authorization: `Bearer ${before}` });
    expect(await stale.json()).toBeNull();
    expect((await post("/sign-in/email", { email, password })).status).toBe(
      401,
    );
    expect(
      (await post("/sign-in/email", { email, password: newPassword })).status,
    ).toBe(200);
    expect((await capturedMail()).map((m) => m.kind)).toContain(
      "password-reset-completed",
    );
  });

  it("does not mount change-email", async () => {
    const signedIn = await post("/sign-in/email", {
      email,
      password: "a-brand-new-passphrase".padEnd(PASSWORD_MIN_LENGTH),
    });
    const res = await post(
      "/change-email",
      { newEmail: "thief@example.com" },
      { authorization: `Bearer ${signedIn.headers.get("set-auth-token")}` },
    );
    expect(res.status).not.toBe(200);
    const rows = await client.query<{ email: string }>(
      'select email from "user"',
    );
    expect(rows.rows.map((r) => r.email)).toEqual([email]);
  });
});

describe("account security against Postgres (issue #79)", () => {
  it("stores a two-factor enrolment in two_factor and turns it on", async () => {
    const who = "twofa@example.com";
    const up = await post("/sign-up/email", {
      email: who,
      password,
      name: who,
    });
    const bearer = {
      authorization: `Bearer ${up.headers.get("set-auth-token")}`,
    };
    await client.query(
      'update "user" set email_verified = true where email = $1',
      [who],
    );
    const enabled = await post("/two-factor/enable", { password }, bearer);
    expect(enabled.status).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await post(
      "/two-factor/verify-totp",
      { code: totpFromUri(totpURI) },
      bearer,
    );
    expect(verified.status).toBe(200);
    const rows = await client.query<{ on: boolean; n: number }>(
      `select u.two_factor_enabled as on,
              (select count(*)::int from two_factor t where t.user_id = u.id) as n
         from "user" u where u.email = $1`,
      [who],
    );
    expect(rows.rows[0]).toEqual({ on: true, n: 1 });
  });

  it("signs in with a first password written by hashAccountPassword", async () => {
    // A Google-only account: a user row and no credential account.
    const who = "google-only@example.com";
    await client.query(
      `insert into "user" (id, name, email, email_verified) values ('g1', $1, $1, true)`,
      [who],
    );
    const first = "a-first-passphrase".padEnd(PASSWORD_MIN_LENGTH, "z");
    expect(
      (await post("/sign-in/email", { email: who, password: first })).status,
    ).toBe(401);
    await client.query(
      `insert into account (id, account_id, provider_id, user_id, password)
       values ('a1', 'g1', 'credential', 'g1', $1)`,
      [await hashAccountPassword(first)],
    );
    expect(
      (await post("/sign-in/email", { email: who, password: first })).status,
    ).toBe(200);
  });
});
