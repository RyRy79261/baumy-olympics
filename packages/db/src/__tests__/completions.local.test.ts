import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { logCompletion, type LogCompletionResult } from "../completions";
import { HOUSEHOLD_ID } from "../household";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import * as schema from "../schema";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";

// The chore lock under real concurrency. PGlite is a single connection, so it
// serialises every transaction and cannot show a race; this file runs in the
// db-local CI lane against Docker Postgres, where each withTransaction is its
// own pool and connection (SPEC §10, issue #13).
//
// Each transaction holds on for a moment after logging, as a slow request
// would. Without `FOR UPDATE` the other one validates against a snapshot that
// cannot see the uncommitted insert, and both claims get in.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const NOW = new Date("2026-09-27T10:00:00Z");
const db = () => createHttpDb() as unknown as Queryable;
const memberIds: string[] = [];
const choreIds: string[] = [];

afterAll(async () => {
  if (choreIds.length > 0) {
    const ids = db()
      .select({ id: schema.completions.id })
      .from(schema.completions)
      .where(inArray(schema.completions.choreId, choreIds));
    await db()
      .delete(schema.completionScores)
      .where(inArray(schema.completionScores.completionId, ids));
    await db()
      .delete(schema.completions)
      .where(inArray(schema.completions.choreId, choreIds));
    await db()
      .delete(schema.choreRuleVersions)
      .where(inArray(schema.choreRuleVersions.choreId, choreIds));
    await db().delete(schema.chores).where(inArray(schema.chores.id, choreIds));
  }
  if (memberIds.length > 0) {
    await db()
      .delete(schema.members)
      .where(inArray(schema.members.id, memberIds));
  }
});

async function player(): Promise<string> {
  const id = await seedPlayer(db());
  memberIds.push(id);
  return id;
}

async function trash(): Promise<string> {
  const { choreId } = await seedChore(db(), {
    ...SEED_CHORES.trash,
    name: `Trash ${randomUUID()}`,
  });
  choreIds.push(choreId);
  return choreId;
}

function attempt(
  choreId: string,
  member: string,
  clientRequestId = randomUUID(),
): Promise<LogCompletionResult> {
  return withTransaction(async (tx) => {
    const r = await logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy: member,
      loggedBy: member,
      occurredAt: NOW,
      now: NOW,
      source: "ui",
      clientRequestId,
    });
    await tx.execute(sql`select pg_sleep(0.3)`);
    return r;
  });
}

async function stored(choreId: string) {
  return db()
    .select({ id: schema.completions.id })
    .from(schema.completions)
    .where(eq(schema.completions.choreId, choreId));
}

describe("logCompletion under concurrent requests", () => {
  it("lets one of two racing claims in and gives the other COOLDOWN", async () => {
    const [ryan, partner] = [await player(), await player()];
    for (let round = 0; round < 3; round += 1) {
      const choreId = await trash();
      const results = await Promise.all([
        attempt(choreId, ryan),
        attempt(choreId, partner),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        expect.objectContaining({ ok: false, code: "COOLDOWN" }),
      ]);
      await expect(stored(choreId)).resolves.toHaveLength(1);
    }
  });

  it("stores one completion for a burst of repeats of one request id", async () => {
    const ryan = await player();
    const choreId = await trash();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => attempt(choreId, ryan, key)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const oks = results.filter((r) => r.ok);
    expect(oks.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(oks.map((r) => r.completion.id)).size).toBe(1);
    await expect(stored(choreId)).resolves.toHaveLength(1);
  });
});
