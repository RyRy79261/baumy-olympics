// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LoginRequestState } from "@baumy/db/login-requests";
import type { LoginApprovalMessage } from "@/lib/integrations/brain";
import { memoryRateLimit } from "@/lib/rate-limit";
import {
  LOGIN_COOKIE,
  LOGIN_COOKIE_MAX_AGE_S,
  LOGIN_COOKIE_PATH,
  NEUTRAL_MESSAGE,
  START_LIMITS,
  handleExchange,
  handleStart,
  handleStatus,
  loginCookie,
  readLoginCookie,
  type LoginApprovalDeps,
  type NewRequest,
} from "./flow";

// The "Sign in with Baumy" routes against fakes (issue #80): the same answer
// for every address, the browser-bound cookie, the one-time exchange, the
// limits and the origin check.

const NOW = new Date("2026-09-28T10:00:00Z");
const ORIGIN = "http://localhost:3000";
const SECRET = "A".repeat(43);
const RYAN = {
  memberId: "11111111-1111-4111-8111-111111111111",
  authUserId: "user-ryan",
  telegramUserId: 42,
};

interface Fake {
  deps: LoginApprovalDeps;
  created: NewRequest[];
  sent: LoginApprovalMessage[];
  pendingAfter: (() => Promise<void>)[];
  errors: string[];
  states: Map<string, LoginRequestState>;
  claims: Map<string, { requestId: string; authUserId: string } | null>;
  signIns: string[];
}

function fake(overrides: Partial<LoginApprovalDeps> = {}): Fake {
  const f: Omit<Fake, "deps"> = {
    created: [],
    sent: [],
    pendingAfter: [],
    errors: [],
    states: new Map(),
    claims: new Map(),
    signIns: [],
  };
  let seq = 0;
  let bucket = 0;
  const deps: LoginApprovalDeps = {
    now: () => NOW,
    // A fresh limiter per fake: the keys are the same across tests.
    rateLimiter: {
      limit: async (key, opts) =>
        memoryRateLimit(`${bucket}:${key}`, opts, NOW.getTime()),
    },
    randomInt: (min, max) => min + (seq++ % (max - min)),
    randomSecret: () => SECRET,
    findCandidate: async (email) =>
      email.toLowerCase() === "ryan@example.com" ? RYAN : null,
    isLocked: async () => false,
    createRequest: async (input) => {
      f.created.push(input);
      return {
        id: `req-${f.created.length}`,
        expiresAt: new Date(NOW.getTime() + 120_000),
      };
    },
    findBySecret: async (secret) => {
      const state = f.states.get(secret);
      return state ? { id: "req-1", state } : null;
    },
    claim: async (secret) => {
      const c = f.claims.get(secret) ?? null;
      f.claims.set(secret, null); // single use, as the database does it
      return c;
    },
    sendApproval: async (message) => {
      f.sent.push(message);
      return { ok: true, data: { sent: true } };
    },
    afterResponse: (fn) => {
      f.pendingAfter.push(fn);
    },
    signIn: async (authUserId) => {
      f.signIns.push(authUserId);
      return ["baumy.session_token=signed; Path=/; HttpOnly; SameSite=Lax"];
    },
    authMayServe: () => true,
    logError: (message) => {
      f.errors.push(message);
    },
    ...overrides,
  };
  bucket = Math.random();
  return { ...f, deps };
}

async function drain(f: Fake) {
  for (const fn of f.pendingAfter.splice(0)) await fn();
}

function start(
  body: unknown,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
) {
  return new Request(`${ORIGIN}${LOGIN_COOKIE_PATH}/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const withCookie = (
  path: string,
  method: "GET" | "POST",
  cookie: string | null = `${LOGIN_COOKIE}=${SECRET}`,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
) =>
  new Request(`${ORIGIN}${LOGIN_COOKIE_PATH}/${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });

describe("handleStart", () => {
  it("answers every address the same way, and messages only a linked member", async () => {
    const f = fake();
    const known = await handleStart(
      start({ email: "Ryan@example.com" }),
      f.deps,
    );
    const unknown = await handleStart(
      start({ email: "nobody@example.com" }),
      f.deps,
    );
    for (const res of [known, unknown]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("set-cookie")).toBe(
        loginCookie(SECRET, LOGIN_COOKIE_MAX_AGE_S),
      );
    }
    const [a, b] = [await known.json(), await unknown.json()];
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a).toMatchObject({
      ok: true,
      expiresAt: "2026-09-28T10:02:00.000Z",
      message: NEUTRAL_MESSAGE,
    });
    expect(a.code).toBeGreaterThanOrEqual(10);
    // The secret never leaves in the body.
    expect(JSON.stringify(a)).not.toContain(SECRET);

    // Both requests are stored; only the member's names them, with its audit.
    expect(f.created.map((c) => [c.memberId, c.audit])).toEqual([
      [RYAN.memberId, { ip: "203.0.113.7" }],
      [null, undefined],
    ]);
    expect(f.created[0]).toMatchObject({
      secret: SECRET,
      device: "Chrome on macOS",
      now: NOW,
    });
    expect(f.created[0]!.choices).toContain(a.code);

    // The DM goes out after the response, for the member only.
    expect(f.sent).toEqual([]);
    await drain(f);
    expect(f.sent).toEqual([
      {
        requestId: "req-1",
        telegramUserId: RYAN.telegramUserId,
        device: "Chrome on macOS",
        choices: f.created[0]!.choices,
        expiresAt: "2026-09-28T10:02:00.000Z",
      },
    ]);
  });

  it("treats a locked member like an unknown address, and asks for everyone", async () => {
    const asked: string[] = [];
    const f = fake({
      isLocked: async (memberId) => {
        asked.push(memberId);
        return memberId === RYAN.memberId;
      },
    });
    const res = await handleStart(start({ email: "ryan@example.com" }), f.deps);
    expect(res.status).toBe(200);
    await handleStart(start({ email: "nobody@example.com" }), f.deps);
    expect(asked).toEqual([
      RYAN.memberId,
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(f.created[0]!.memberId).toBeNull();
    await drain(f);
    expect(f.sent).toEqual([]);
  });

  it("logs a DM brain did not send, and still answers the same", async () => {
    for (const answer of [
      { ok: false, reason: "unavailable" } as const,
      { ok: true, data: { sent: false } } as const,
    ]) {
      const f = fake({ sendApproval: async () => answer });
      const res = await handleStart(
        start({ email: "ryan@example.com" }),
        f.deps,
      );
      expect(res.status).toBe(200);
      await drain(f);
      expect(f.errors).toHaveLength(1);
      expect(f.errors[0]).toContain("did not send the approval DM");
    }
  });

  it("refuses a cross-site request before reading anything", async () => {
    const f = fake();
    const res = await handleStart(
      start({ email: "ryan@example.com" }, { "sec-fetch-site": "cross-site" }),
      f.deps,
    );
    expect(res.status).toBe(403);
    expect(f.created).toEqual([]);
  });

  it("refuses a body that is not an address", async () => {
    const f = fake();
    for (const body of ["not json", { email: "nope" }, { email: "" }, {}]) {
      const res = await handleStart(start(body), f.deps);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(f.created).toEqual([]);
  });

  it("limits each address, whether or not it has an account", async () => {
    for (const email of ["ryan@example.com", "nobody@example.com"]) {
      const f = fake();
      for (let i = 0; i < START_LIMITS.email.limit; i++) {
        expect((await handleStart(start({ email }), f.deps)).status).toBe(200);
      }
      const res = await handleStart(
        start({ email: email.toUpperCase() }),
        f.deps,
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
    }
  });

  it("limits each IP across addresses", async () => {
    const f = fake();
    for (let i = 0; i < START_LIMITS.ip.limit; i++) {
      await handleStart(start({ email: `a${i}@example.com` }), f.deps);
    }
    const res = await handleStart(start({ email: "z@example.com" }), f.deps);
    expect(res.status).toBe(429);
  });

  it("is closed when auth may not serve", async () => {
    const f = fake({ authMayServe: () => false });
    const res = await handleStart(start({ email: "ryan@example.com" }), f.deps);
    expect(res.status).toBe(503);
  });

  it("answers a generic 500 when something throws", async () => {
    const f = fake({
      createRequest: async () => {
        throw new Error("db down at postgres://secret");
      },
    });
    const res = await handleStart(start({ email: "ryan@example.com" }), f.deps);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("postgres");
    expect(f.errors).toEqual(["[login-approval] start failed"]);
  });
});

describe("handleStatus", () => {
  it("reads the state of this browser's request", async () => {
    const f = fake();
    for (const state of ["pending", "approved", "denied", "used"] as const) {
      f.states.set(SECRET, state);
      const res = await handleStatus(withCookie("status", "GET"), f.deps);
      expect(await res.json()).toEqual({ ok: true, status: state });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("reads a missing cookie, a strange one or an unknown secret as expired", async () => {
    const f = fake();
    for (const cookie of [
      null,
      `${LOGIN_COOKIE}=short`,
      `other=1; ${LOGIN_COOKIE}=${"B".repeat(43)}`,
    ]) {
      const res = await handleStatus(
        withCookie("status", "GET", cookie),
        f.deps,
      );
      expect(await res.json()).toEqual({ ok: true, status: "expired" });
    }
  });

  it("answers a generic 500 when the read throws", async () => {
    const f = fake({
      findBySecret: async () => {
        throw new Error("boom");
      },
    });
    const res = await handleStatus(withCookie("status", "GET"), f.deps);
    expect(res.status).toBe(500);
  });
});

describe("handleExchange", () => {
  it("trades an approved request for the session once, and clears the cookie", async () => {
    const f = fake();
    f.claims.set(SECRET, { requestId: "req-1", authUserId: RYAN.authUserId });
    const res = await handleExchange(withCookie("exchange", "POST"), f.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookies = res.headers.getSetCookie();
    expect(cookies[0]).toContain("baumy.session_token=signed");
    expect(cookies[1]).toBe(loginCookie("", 0));
    expect(f.signIns).toEqual([RYAN.authUserId]);

    // A replay (or another tab) gets nothing.
    const again = await handleExchange(withCookie("exchange", "POST"), f.deps);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "INVALID_STATE" });
    expect(f.signIns).toHaveLength(1);
  });

  it("gives no session without the cookie, or before approval", async () => {
    const f = fake();
    const bare = await handleExchange(
      withCookie("exchange", "POST", null),
      f.deps,
    );
    expect(bare.status).toBe(409);
    expect(bare.headers.get("set-cookie")).toBe(loginCookie("", 0));
    const unapproved = await handleExchange(
      withCookie("exchange", "POST"),
      f.deps,
    );
    expect(unapproved.status).toBe(409);
    expect(f.signIns).toEqual([]);
  });

  it("refuses a cross-site request, and is closed when auth may not serve", async () => {
    const f = fake();
    f.claims.set(SECRET, { requestId: "req-1", authUserId: RYAN.authUserId });
    const cross = await handleExchange(
      withCookie("exchange", "POST", undefined, {
        "sec-fetch-site": "cross-site",
      }),
      f.deps,
    );
    expect(cross.status).toBe(403);
    const closed = await handleExchange(
      withCookie("exchange", "POST"),
      fake({ authMayServe: () => false }).deps,
    );
    expect(closed.status).toBe(503);
    expect(f.signIns).toEqual([]);
  });

  it("is rate limited per IP", async () => {
    const f = fake();
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) {
      last = await handleExchange(withCookie("exchange", "POST"), f.deps);
    }
    expect(last!.status).toBe(429);
  });

  it("answers a generic 500 when the session cannot be made", async () => {
    const f = fake({
      signIn: async () => {
        throw new Error("boom");
      },
    });
    f.claims.set(SECRET, { requestId: "req-1", authUserId: RYAN.authUserId });
    const res = await handleExchange(withCookie("exchange", "POST"), f.deps);
    expect(res.status).toBe(500);
    expect(f.errors).toEqual(["[login-approval] exchange failed"]);
  });
});

describe("the cookie", () => {
  it("is httpOnly, Secure, SameSite=Strict and scoped to these routes", () => {
    const c = loginCookie(SECRET, LOGIN_COOKIE_MAX_AGE_S);
    expect(c).toContain(`${LOGIN_COOKIE}=${SECRET}`);
    expect(c).toContain(`Path=${LOGIN_COOKIE_PATH}`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain(`Max-Age=${LOGIN_COOKIE_MAX_AGE_S}`);
  });

  it("is read back only when it looks like a secret", () => {
    const req = (cookie: string) =>
      new Request(ORIGIN, { headers: { cookie } });
    expect(readLoginCookie(req(`${LOGIN_COOKIE}=${SECRET}`))).toBe(SECRET);
    expect(readLoginCookie(req(`a=b; ${LOGIN_COOKIE}=${SECRET}`))).toBe(SECRET);
    expect(readLoginCookie(req(`${LOGIN_COOKIE}=bad value!`))).toBeNull();
    expect(readLoginCookie(new Request(ORIGIN))).toBeNull();
  });
});
