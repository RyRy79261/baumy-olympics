import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limiter seam: Postgres first, the in-memory bucket when the count
// cannot be stored, and the bucket alone in E2E test mode.

const consume = vi.fn();
vi.mock("@baumy/db/rate-limit", () => ({
  consumeRateLimit: (input: unknown) => consume(input),
}));

const { __resetMemoryRateLimits, getClientIp, memoryRateLimit, rateLimiter } =
  await import("./rate-limit");

beforeEach(() => {
  consume.mockReset();
  __resetMemoryRateLimits();
});
afterEach(() => vi.unstubAllEnvs());

describe("memoryRateLimit", () => {
  it("allows `limit` calls, then refuses with a retry time, then refills", () => {
    const opts = { limit: 2, windowMs: 10_000 };
    expect(memoryRateLimit("k", opts, 0).ok).toBe(true);
    expect(memoryRateLimit("k", opts, 0).ok).toBe(true);
    expect(memoryRateLimit("k", opts, 0)).toEqual({
      ok: false,
      retryAfterSeconds: 5,
    });
    // One token back after half the window.
    expect(memoryRateLimit("k", opts, 5_000).ok).toBe(true);
    expect(memoryRateLimit("other", opts, 0).ok).toBe(true);
  });

  it("sweeps idle buckets every 200 calls", () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(memoryRateLimit("idle", opts, 0).ok).toBe(true);
    expect(memoryRateLimit("idle", opts, 0).ok).toBe(false);
    for (let i = 0; i < 198; i++) memoryRateLimit(`k${i}`, opts, 5000);
    // The 200th call sweeps "idle", so it starts full, not refilled-by-time.
    expect(
      memoryRateLimit("idle", { limit: 1, windowMs: 1_000_000 }, 5000).ok,
    ).toBe(true);
  });
});

describe("rateLimiter", () => {
  it("uses the Postgres verdict", async () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    consume.mockResolvedValue({ ok: false, retryAfterSeconds: 9 });
    await expect(
      rateLimiter.limit("k", { limit: 1, windowMs: 1000 }),
    ).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 9,
    });
    expect(consume).toHaveBeenCalledWith({
      key: "k",
      limit: 1,
      windowMs: 1000,
    });
  });

  it("falls back to the in-memory bucket when the count cannot be stored", async () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    consume.mockResolvedValue(null);
    const opts = { limit: 1, windowMs: 60_000 };
    await expect(rateLimiter.limit("k", opts)).resolves.toMatchObject({
      ok: true,
    });
    await expect(rateLimiter.limit("k", opts)).resolves.toMatchObject({
      ok: false,
    });
  });

  it("counts in memory only in E2E test mode", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    await expect(
      rateLimiter.limit("k", { limit: 1, windowMs: 1000 }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(consume).not.toHaveBeenCalled();
  });
});

describe("getClientIp", () => {
  it("takes the first forwarded address, then x-real-ip, then unknown", () => {
    expect(
      getClientIp(new Headers({ "x-forwarded-for": " 1.1.1.1 , 2.2.2.2" })),
    ).toBe("1.1.1.1");
    expect(getClientIp(new Headers({ "x-real-ip": "3.3.3.3" }))).toBe(
      "3.3.3.3",
    );
    expect(getClientIp(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
