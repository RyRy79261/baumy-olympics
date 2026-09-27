import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHttpDb, isLocalProxy } from "../index";
import { RATE_LIMIT_ROW_HORIZON_MS, consumeRateLimit } from "../rate-limit";
import * as schema from "../schema";

// consumeRateLimit against real Postgres with real concurrency: under
// NEON_LOCAL_PROXY=1 createHttpDb reads over a shared pool of up to 10
// WebSocket connections, so these calls run as separate, overlapping
// statements. A read-then-write limiter lets extra attempts through here, and
// loses counts; the single upsert must do neither.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const WINDOW = 60_000;
const keys: string[] = [];

function freshKey(): string {
  const key = `test:${randomUUID()}`;
  keys.push(key);
  return key;
}

afterAll(async () => {
  for (const key of keys) {
    await createHttpDb()
      .delete(schema.actionRateLimit)
      .where(eq(schema.actionRateLimit.key, key));
  }
});

describe("consumeRateLimit under concurrent calls", () => {
  it("lets exactly `limit` through and counts every attempt", async () => {
    const key = freshKey();
    const attempts = 60;
    const limit = 25;
    const verdicts = await Promise.all(
      Array.from({ length: attempts }, () =>
        consumeRateLimit({ key, limit, windowMs: WINDOW }),
      ),
    );

    expect(verdicts.every((v) => v !== null)).toBe(true);
    expect(verdicts.filter((v) => v?.ok)).toHaveLength(limit);
    expect(verdicts.filter((v) => v && !v.ok)).toHaveLength(attempts - limit);

    const [row] = await createHttpDb()
      .select()
      .from(schema.actionRateLimit)
      .where(eq(schema.actionRateLimit.key, key));
    expect(row?.count).toBe(attempts);
  });

  it("creates one row when the first attempts on a key race", async () => {
    // The first call for a key INSERTs. Racing first calls must meet in
    // ON CONFLICT, not fail on the primary key.
    const key = freshKey();
    const verdicts = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeRateLimit({ key, limit: 3, windowMs: WINDOW }),
      ),
    );
    expect(verdicts.every((v) => v !== null)).toBe(true);
    expect(verdicts.filter((v) => v?.ok)).toHaveLength(3);
  });

  it("does not deadlock when racing calls each find the others' rows stale", async () => {
    // Each call upserts its own week-old row (locking it) and sweeps the
    // others' week-old rows. Without SKIP LOCKED in the sweep they wait on
    // each other, Postgres fails one as a deadlock, and it returns null.
    for (let round = 0; round < 5; round++) {
      const stale = Array.from({ length: 10 }, freshKey);
      await createHttpDb()
        .insert(schema.actionRateLimit)
        .values(
          stale.map((key) => ({
            key,
            count: 1,
            windowStart: Date.now() - RATE_LIMIT_ROW_HORIZON_MS - 60_000,
          })),
        );
      const verdicts = await Promise.all(
        stale.map((key) =>
          consumeRateLimit({ key, limit: 5, windowMs: WINDOW }),
        ),
      );
      expect(verdicts).toHaveLength(stale.length);
      expect(verdicts.filter((v) => v === null)).toHaveLength(0);
      expect(verdicts.every((v) => v?.ok)).toBe(true);
    }
  });
});
