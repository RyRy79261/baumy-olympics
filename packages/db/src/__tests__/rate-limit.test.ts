import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "./_harness";
import { RATE_LIMIT_ROW_HORIZON_MS, consumeRateLimit } from "../rate-limit";
import * as schema from "../schema";

// The shared rate limit on real Postgres: one counter per key, a fixed
// window, the sweep of week-old rows, and null when storage fails.

const WINDOW = 60_000;
const T0 = new Date("2026-09-16T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("consumeRateLimit", () => {
  const h = useTestDb();

  it("allows the limit, then refuses with the seconds left in the window", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        await consumeRateLimit({
          key: "k",
          limit: 3,
          windowMs: WINDOW,
          now: T0,
        }),
      ).toEqual({ ok: true, retryAfterSeconds: 0 });
    }
    expect(
      await consumeRateLimit({
        key: "k",
        limit: 3,
        windowMs: WINDOW,
        now: at(15_500),
      }),
    ).toEqual({ ok: false, retryAfterSeconds: 45 });
  });

  it("starts a new window once the old one has ended", async () => {
    await consumeRateLimit({ key: "k", limit: 1, windowMs: WINDOW, now: T0 });
    expect(
      (
        await consumeRateLimit({
          key: "k",
          limit: 1,
          windowMs: WINDOW,
          now: at(59_999),
        })
      )?.ok,
    ).toBe(false);
    expect(
      await consumeRateLimit({
        key: "k",
        limit: 1,
        windowMs: WINDOW,
        now: at(WINDOW),
      }),
    ).toEqual({ ok: true, retryAfterSeconds: 0 });

    const [row] = await h.db().select().from(schema.actionRateLimit);
    expect(row).toEqual({
      key: "k",
      count: 1,
      windowStart: at(WINDOW).getTime(),
    });
  });

  it("keeps each key's count apart", async () => {
    await consumeRateLimit({ key: "a", limit: 1, windowMs: WINDOW, now: T0 });
    expect(
      (
        await consumeRateLimit({
          key: "a",
          limit: 1,
          windowMs: WINDOW,
          now: T0,
        })
      )?.ok,
    ).toBe(false);
    expect(
      (
        await consumeRateLimit({
          key: "b",
          limit: 1,
          windowMs: WINDOW,
          now: T0,
        })
      )?.ok,
    ).toBe(true);
  });

  it("sweeps other keys' week-old rows and keeps live ones", async () => {
    const db = h.db();
    await db.insert(schema.actionRateLimit).values([
      {
        key: "old",
        count: 9,
        windowStart: T0.getTime() - RATE_LIMIT_ROW_HORIZON_MS - 1,
      },
      { key: "day", count: 2, windowStart: T0.getTime() - 86_400_000 + 1 },
    ]);

    await consumeRateLimit({ key: "now", limit: 5, windowMs: WINDOW, now: T0 });

    const keys = (await db.select().from(schema.actionRateLimit)).map(
      (r) => r.key,
    );
    expect(keys.sort()).toEqual(["day", "now"]);
  });

  it("restarts its own week-old row instead of sweeping it", async () => {
    await h
      .db()
      .insert(schema.actionRateLimit)
      .values({
        key: "k",
        count: 9,
        windowStart: T0.getTime() - RATE_LIMIT_ROW_HORIZON_MS - 1,
      });
    expect(
      await consumeRateLimit({ key: "k", limit: 1, windowMs: WINDOW, now: T0 }),
    ).toEqual({ ok: true, retryAfterSeconds: 0 });
  });

  it("counts every attempt in a burst", async () => {
    const verdicts = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeRateLimit({ key: "burst", limit: 5, windowMs: WINDOW, now: T0 }),
      ),
    );
    expect(verdicts.filter((v) => v?.ok)).toHaveLength(5);
  });

  it("returns null and logs when the counter cannot be stored", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await h.client().exec("DROP TABLE action_rate_limit");
    try {
      expect(
        await consumeRateLimit({
          key: "k",
          limit: 1,
          windowMs: WINDOW,
          now: T0,
        }),
      ).toBeNull();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
      await h.client().exec(`
        CREATE TABLE "action_rate_limit" (
          "key" text PRIMARY KEY NOT NULL,
          "count" integer NOT NULL,
          "window_start" bigint NOT NULL
        )`);
    }
  });

  it("counts on the database clock when no clock is given", async () => {
    // Production passes no clock. The window must start at the database's
    // now(), the one clock every server instance shares. (PGlite reads the
    // test process's clock, so this cannot tell a drifting server apart; it
    // proves the no-clock path counts and stores the database's time.)
    expect(
      await consumeRateLimit({ key: "db-clock", limit: 1, windowMs: WINDOW }),
    ).toEqual({ ok: true, retryAfterSeconds: 0 });
    const denied = await consumeRateLimit({
      key: "db-clock",
      limit: 1,
      windowMs: WINDOW,
    });
    expect(denied?.ok).toBe(false);
    expect(denied?.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied?.retryAfterSeconds).toBeLessThanOrEqual(60);

    const {
      rows: [row],
    } = await h.client().query<{ drift_ms: number }>(
      `SELECT abs((extract(epoch from now()) * 1000) - window_start)::float8 AS drift_ms
         FROM action_rate_limit WHERE key = 'db-clock'`,
    );
    expect(row!.drift_ms).toBeLessThan(60_000);
  });

  it("refuses a limit or window no caller should pass", async () => {
    await expect(
      consumeRateLimit({ key: "k", limit: 0, windowMs: WINDOW }),
    ).rejects.toThrow(RangeError);
    await expect(
      consumeRateLimit({
        key: "k",
        limit: 1,
        windowMs: RATE_LIMIT_ROW_HORIZON_MS + 1,
      }),
    ).rejects.toThrow(RangeError);
  });
});
