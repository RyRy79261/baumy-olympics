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
import { APPROVAL_SIGN_IN_PATH } from "../approval-sign-in";
import { createAuth, type Auth } from "../config";
import { PASSWORD_MIN_LENGTH } from "../password";

// "Sign in with Baumy" (issue #80): the server-only endpoint that makes the
// session once the web app has decided the member approved it. Against the
// real Better Auth instance and Postgres (PGlite), as flows.test.ts does.

const MIGRATIONS = fileURLToPath(
  new URL("../../../db/migrations", import.meta.url),
);
const ORIGIN = "http://localhost:3000";

let client: PGlite;
let auth: Auth;
let userId: string;

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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  auth = createAuth({ BETTER_AUTH_URL: ORIGIN, E2E_TEST_MODE: "1" });
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        email: "approved@example.com",
        password: "approved-passphrase".padEnd(PASSWORD_MIN_LENGTH, "x"),
        name: "Approved",
      }),
    }),
  );
  userId = ((await res.json()) as { user: { id: string } }).user.id;
}, 60_000);

afterAll(async () => {
  __setDbOverride(null);
  await client.close();
  vi.restoreAllMocks();
});

const browser = new Headers({
  "user-agent": "Mozilla/5.0 (Macintosh) Chrome/140",
  "x-forwarded-for": "203.0.113.9",
});

describe("signInApproved", () => {
  it("is not reachable over HTTP", async () => {
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth${APPROVAL_SIGN_IN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ userId }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("makes a session with the signed cookie, for the browser that asked", async () => {
    const { headers, response } = await auth.api.signInApproved({
      body: { userId },
      headers: browser,
      returnHeaders: true,
    });
    expect(response.userId).toBe(userId);
    const cookies = headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("baumy.session_token="));
    expect(session).toMatch(/HttpOnly/i);

    // The cookie is a working session.
    const cookie = session!.split(";")[0]!;
    const got = await auth.handler(
      new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }),
    );
    const body = (await got.json()) as {
      user: { id: string };
      session: { id: string; userAgent: string; ipAddress: string };
    };
    expect(body.user.id).toBe(userId);
    expect(body.session.id).toBe(response.sessionId);
    // The security page lists it with the device that asked.
    expect(body.session.userAgent).toContain("Chrome/140");
  });

  it("refuses an unknown user", async () => {
    await expect(
      auth.api.signInApproved({
        body: { userId: "nobody" },
        headers: browser,
      }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("refuses a call that carries a request", async () => {
    // With a request, Better Auth answers with a Response instead of throwing.
    const res = (await auth.api.signInApproved({
      body: { userId },
      request: new Request(`${ORIGIN}/api/auth${APPROVAL_SIGN_IN_PATH}`, {
        method: "POST",
      }),
    } as never)) as unknown as Response;
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
