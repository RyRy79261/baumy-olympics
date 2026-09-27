import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { now, resetClock } from "@/lib/clock";
import { GET, POST } from "./route";

const REAL = new Date("2026-09-27T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/test/clock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: REAL, toFake: ["Date"] });
});

afterEach(() => {
  vi.stubEnv("E2E_TEST_MODE", "1");
  resetClock();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/api/test/clock in test mode", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_TEST_MODE", "1");
  });

  it("GET reports the server clock", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      now: REAL.toISOString(),
      offsetMs: 0,
    });
  });

  it("POST advanceMs moves now() and accumulates", async () => {
    await post({ advanceMs: HOUR });
    const res = await post({ advanceMs: HOUR });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      now: new Date(REAL.getTime() + 2 * HOUR).toISOString(),
      offsetMs: 2 * HOUR,
    });
    expect(now().getTime()).toBe(REAL.getTime() + 2 * HOUR);
  });

  it("POST offsetMs sets and POST reset clears", async () => {
    await post({ advanceMs: HOUR });
    const set = await post({ offsetMs: -HOUR });
    expect((await set.json()).offsetMs).toBe(-HOUR);

    const reset = await post({ reset: true });
    expect(await reset.json()).toEqual({
      now: REAL.toISOString(),
      offsetMs: 0,
    });
  });

  it.each([
    ["not JSON", "{nope"],
    ["an empty object", {}],
    ["two keys", { advanceMs: 1, offsetMs: 1 }],
    ["a string amount", { advanceMs: "1000" }],
    ["a fractional amount", { advanceMs: 1.5 }],
    ["more than ten years", { advanceMs: 11 * 366 * 24 * HOUR }],
    ["reset: false", { reset: false }],
  ])("POST rejects %s with 400 and leaves the clock alone", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(now().getTime()).toBe(REAL.getTime());
  });
});

describe("/api/test/clock outside test mode", () => {
  it.each(["", "0", "true"])(
    "answers 404 to GET and POST when E2E_TEST_MODE=%j",
    async (value) => {
      vi.stubEnv("E2E_TEST_MODE", value);

      expect(GET().status).toBe(404);
      const res = await post({ advanceMs: HOUR });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
      expect(now().getTime()).toBe(REAL.getTime());
    },
  );

  it("does not apply an offset set while test mode was on", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    expect((await post({ advanceMs: HOUR })).status).toBe(200);

    vi.stubEnv("E2E_TEST_MODE", "");
    expect(now().getTime()).toBe(REAL.getTime());
    expect(GET().status).toBe(404);
  });
});
