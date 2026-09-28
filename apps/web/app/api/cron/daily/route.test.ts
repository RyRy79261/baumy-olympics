// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@baumy/db/test-harness";
import { GET } from "./route";

// The daily job's route (SPEC §6.7): the CRON_SECRET guard, which fails
// closed, and a run on PGlite that a second run finds nothing left to do.

useTestDb();

const SECRET = "cron-secret-for-tests";

function get(authorization?: string) {
  return GET(
    new Request("http://localhost:3000/api/cron/daily", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/daily", () => {
  it("refuses to run with no CRON_SECRET set", async () => {
    vi.stubEnv("CRON_SECRET", "  ");
    const res = await get(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/CRON_SECRET is not set/);
  });

  it("refuses a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const header of [
      undefined,
      SECRET,
      `Bearer ${SECRET}x`,
      "Bearer wrong",
      `bearer ${SECRET}`,
    ]) {
      const res = await get(header);
      expect(res.status).toBe(401);
    }
  });

  it("runs every step, and a second run is a no-op", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("E2E_TEST_MODE", "1");
    const first = await get(`Bearer ${SECRET}`);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.ok).toBe(true);
    expect(body.steps.map((s: { step: string }) => s.step)).toEqual([
      "settle",
      "seasons",
      "weights",
      "photos",
      "logins",
    ]);
    const second = await (await get(`Bearer ${SECRET}`)).json();
    expect(second.steps[0].detail).toEqual({
      finalized: 0,
      expired: 0,
      timedOut: 0,
    });
    expect(second.steps[1].detail).toEqual({ closing: 0, closed: 0 });
  });
});
