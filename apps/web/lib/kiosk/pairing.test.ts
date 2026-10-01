// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashKioskToken } from "@baumy/db/kiosk-devices";
import type { KioskPairingState } from "@baumy/db/kiosk-pairing";
import { memoryRateLimit } from "@/lib/rate-limit";
import {
  EXCHANGE_LIMIT,
  PAIRING_COOKIE,
  PAIRING_COOKIE_MAX_AGE_S,
  PAIRING_COOKIE_PATH,
  START_LIMIT,
  handleExchange,
  handleStart,
  handleStatus,
  pairingCookie,
  readPairingCookie,
  type KioskPairingDeps,
  type NewPairingRequest,
} from "./pairing";

// The kiosk pairing routes against fakes (issue #126): the iPad's secret in
// its httpOnly cookie, a fresh code on a collision, the status poll, the
// one-time exchange for the device cookie, the limits and the origin check.

const NOW = new Date("2026-10-01T10:00:00Z");
const ORIGIN = "http://localhost:3000";
const SECRET = "S".repeat(43);
const TOKEN = "T".repeat(43);
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

interface Fake {
  deps: KioskPairingDeps;
  created: NewPairingRequest[];
  states: Map<string, KioskPairingState>;
  claims: { secret: string; tokenHash: string }[];
  claimResult: { deviceId: string; name: string } | null;
  errors: string[];
}

let bucket = 0;

function fake(overrides: Partial<KioskPairingDeps> = {}): Fake {
  bucket += 1;
  const mine = bucket;
  const codes = ["TAKEN2", "ABC234", "XYZ234"];
  const f: Omit<Fake, "deps"> = {
    created: [],
    states: new Map(),
    claims: [],
    claimResult: { deviceId: "dev-1", name: "Kitchen" },
    errors: [],
  };
  const deps: KioskPairingDeps = {
    now: () => NOW,
    rateLimiter: {
      limit: async (key, opts) =>
        memoryRateLimit(`${mine}:${key}`, opts, NOW.getTime()),
    },
    randomSecret: () => SECRET,
    newCode: () => codes.shift() ?? "ZZZ234",
    newToken: () => TOKEN,
    createRequest: async (input) => {
      f.created.push(input);
      if (input.code === "TAKEN2") return null;
      return {
        id: `req-${f.created.length}`,
        expiresAt: new Date(NOW.getTime() + 600_000),
      };
    },
    findBySecret: async (secret) => {
      const state = f.states.get(secret);
      return state ? { id: "req-1", state } : null;
    },
    claim: async ({ secret, tokenHash }) => {
      f.claims.push({ secret, tokenHash });
      return f.claimResult;
    },
    logError: (message) => {
      f.errors.push(message);
    },
    ...overrides,
  };
  return Object.assign(f, { deps }) as Fake;
}

function post(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      host: "localhost:3000",
      "sec-fetch-site": "same-origin",
      "user-agent": IPAD_UA,
      ...headers,
    },
  });
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers });
}

const withCookie = (value = SECRET) => ({
  cookie: `${PAIRING_COOKIE}=${value}`,
});

describe("the pairing cookie", () => {
  it("is httpOnly, Secure, SameSite=Strict, scoped to the pairing routes", () => {
    expect(pairingCookie("abc", PAIRING_COOKIE_MAX_AGE_S)).toBe(
      `baumy_kiosk_pairing=abc; Path=${PAIRING_COOKIE_PATH}; Max-Age=660; HttpOnly; Secure; SameSite=Strict`,
    );
  });

  it("reads only a well-formed secret", () => {
    expect(
      readPairingCookie(
        get("/", { cookie: `a=1; ${PAIRING_COOKIE}=${SECRET}` }),
      ),
    ).toBe(SECRET);
    expect(readPairingCookie(get("/", withCookie("short")))).toBeNull();
    expect(readPairingCookie(get("/", withCookie("x;y")))).toBeNull();
    expect(readPairingCookie(get("/"))).toBeNull();
  });
});

describe("POST /api/kiosk-pairing/start", () => {
  it("stores a request, retries a taken code, and gives the iPad the code and its secret cookie", async () => {
    const f = fake();
    const res = await handleStart(post("/api/kiosk-pairing/start"), f.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      code: "ABC234",
      expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    expect(res.headers.get("set-cookie")).toBe(
      pairingCookie(SECRET, PAIRING_COOKIE_MAX_AGE_S),
    );
    expect(f.created.map((c) => c.code)).toEqual(["TAKEN2", "ABC234"]);
    expect(f.created[1]).toEqual({
      secret: SECRET,
      code: "ABC234",
      device: "Safari on iPad",
      now: NOW,
    });
  });

  it("gives up with a 500 when every code is taken", async () => {
    const f = fake({ newCode: () => "TAKEN2" });
    const res = await handleStart(post("/api/kiosk-pairing/start"), f.deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(f.created).toHaveLength(5);
    expect(f.errors).toEqual(["[kiosk-pairing] start failed"]);
  });

  it("refuses a cross-site request before doing anything", async () => {
    const f = fake();
    const res = await handleStart(
      post("/api/kiosk-pairing/start", {
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example",
      }),
      f.deps,
    );
    expect(res.status).toBe(403);
    expect(f.created).toEqual([]);
  });

  it(`is limited to ${START_LIMIT.limit} per IP per 10 minutes`, async () => {
    const f = fake({ newCode: () => "ABC234" });
    const req = () =>
      post("/api/kiosk-pairing/start", { "x-forwarded-for": "203.0.113.9" });
    for (let i = 0; i < START_LIMIT.limit; i++) {
      expect((await handleStart(req(), f.deps)).status).toBe(200);
    }
    const res = await handleStart(req(), f.deps);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
    // Another address is not held up.
    expect(
      (
        await handleStart(
          post("/api/kiosk-pairing/start", {
            "x-forwarded-for": "203.0.113.10",
          }),
          f.deps,
        )
      ).status,
    ).toBe(200);
  });
});

describe("GET /api/kiosk-pairing/status", () => {
  it("says where this iPad's own request stands", async () => {
    const f = fake();
    for (const state of ["pending", "approved", "used", "expired"] as const) {
      f.states.set(SECRET, state);
      const res = await handleStatus(
        get("/api/kiosk-pairing/status", withCookie()),
        f.deps,
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true, status: state });
    }
  });

  it("reads as expired without a cookie or a request", async () => {
    const f = fake();
    for (const req of [
      get("/api/kiosk-pairing/status"),
      get("/api/kiosk-pairing/status", withCookie("U".repeat(43))),
    ]) {
      expect(await (await handleStatus(req, f.deps)).json()).toEqual({
        ok: true,
        status: "expired",
      });
    }
  });

  it("answers a 500 when the lookup throws", async () => {
    const f = fake({
      findBySecret: async () => {
        throw new Error("db down");
      },
    });
    const res = await handleStatus(
      get("/api/kiosk-pairing/status", withCookie()),
      f.deps,
    );
    expect(res.status).toBe(500);
    expect(f.errors).toEqual(["[kiosk-pairing] status failed"]);
  });
});

describe("POST /api/kiosk-pairing/exchange", () => {
  it("trades the approved request for the device cookie, and clears the rest", async () => {
    const f = fake();
    const res = await handleExchange(
      post("/api/kiosk-pairing/exchange", withCookie()),
      f.deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "Kitchen" });
    expect(f.claims).toEqual([
      { secret: SECRET, tokenHash: hashKioskToken(TOKEN) },
    ]);
    expect(res.headers.getSetCookie()).toEqual([
      `baumy_kiosk=${TOKEN}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`,
      "baumy_kiosk_member=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
      pairingCookie("", 0),
    ]);
  });

  it("refuses with 409 when nothing approved is there, and clears the cookie", async () => {
    const f = fake();
    f.claimResult = null;
    const res = await handleExchange(
      post("/api/kiosk-pairing/exchange", withCookie()),
      f.deps,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "INVALID_STATE" });
    expect(res.headers.get("set-cookie")).toBe(pairingCookie("", 0));
    expect(res.headers.get("set-cookie")).not.toContain("baumy_kiosk=");

    // No cookie at all: nothing is claimed.
    const none = await handleExchange(
      post("/api/kiosk-pairing/exchange"),
      f.deps,
    );
    expect(none.status).toBe(409);
    expect(f.claims).toHaveLength(1);
  });

  it("refuses a cross-site request before claiming", async () => {
    const f = fake();
    const res = await handleExchange(
      post("/api/kiosk-pairing/exchange", {
        ...withCookie(),
        "sec-fetch-site": "cross-site",
      }),
      f.deps,
    );
    expect(res.status).toBe(403);
    expect(f.claims).toEqual([]);
  });

  it(`is limited to ${EXCHANGE_LIMIT.limit} per IP per 10 minutes`, async () => {
    const f = fake();
    f.claimResult = null;
    for (let i = 0; i < EXCHANGE_LIMIT.limit; i++) {
      await handleExchange(post("/api/kiosk-pairing/exchange"), f.deps);
    }
    const res = await handleExchange(
      post("/api/kiosk-pairing/exchange"),
      f.deps,
    );
    expect(res.status).toBe(429);
  });

  it("answers a 500 when the claim throws", async () => {
    const f = fake({
      claim: async () => {
        throw new Error("db down");
      },
    });
    const res = await handleExchange(
      post("/api/kiosk-pairing/exchange", withCookie()),
      f.deps,
    );
    expect(res.status).toBe(500);
    expect(f.errors).toEqual(["[kiosk-pairing] exchange failed"]);
  });
});
