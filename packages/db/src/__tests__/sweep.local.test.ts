import { RULESET_V1, berlinWallTimeToUtc, seasonBounds } from "@baumy/core";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { logCompletion } from "../completions";
import { applyCompletionEvent } from "../confirmations";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import * as schema from "../schema";
import { approveAdjustment, createAdjustment } from "../scores";
import { findSeason, lockSeasonShared } from "../seasons";
import { closeDueSeasons, settleDueCompletions } from "../sweep";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";

// The daily job's steps racing each other on Docker Postgres (PGlite
// serialises every transaction and cannot race). SPEC §6.7: every step is
// idempotent and safe against double claims (FOR UPDATE SKIP LOCKED). Each
// test runs in a household of its own on the shared local database.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const HOUR = 60 * 60_000;
const T0 = berlinWallTimeToUtc(2026, 12, 28, 8);
const { endsAt } = seasonBounds(2026);
const CLOSABLE = new Date(endsAt.getTime() + RULESET_V1.maxBackdateH * HOUR);
const db = () => createHttpDb() as unknown as Queryable;
const households: string[] = [];
const memberIds: string[] = [];

afterAll(async () => {
  if (households.length === 0) return;
  const choreIds = db()
    .select({ id: schema.chores.id })
    .from(schema.chores)
    .where(inArray(schema.chores.householdId, households));
  const completionIds = db()
    .select({ id: schema.completions.id })
    .from(schema.completions)
    .where(inArray(schema.completions.householdId, households));
  const seasonIds = db()
    .select({ id: schema.seasons.id })
    .from(schema.seasons)
    .where(inArray(schema.seasons.householdId, households));
  await db()
    .delete(schema.disputes)
    .where(inArray(schema.disputes.completionId, completionIds));
  await db()
    .delete(schema.completionScores)
    .where(inArray(schema.completionScores.completionId, completionIds));
  await db()
    .delete(schema.completions)
    .where(inArray(schema.completions.householdId, households));
  await db()
    .delete(schema.pointAdjustments)
    .where(inArray(schema.pointAdjustments.seasonId, seasonIds));
  await db()
    .delete(schema.choreRuleVersions)
    .where(inArray(schema.choreRuleVersions.choreId, choreIds));
  await db()
    .delete(schema.chores)
    .where(inArray(schema.chores.householdId, households));
  await db()
    .delete(schema.seasons)
    .where(inArray(schema.seasons.householdId, households));
  await db()
    .delete(schema.members)
    .where(inArray(schema.members.id, memberIds));
  await db()
    .delete(schema.households)
    .where(inArray(schema.households.id, households));
});

/** A household with three optimistic claims and one disputed, all due. */
async function arrange() {
  const [household] = await db()
    .insert(schema.households)
    .values({ name: "Sweep race" })
    .returning({ id: schema.households.id });
  const householdId = household!.id;
  households.push(householdId);
  const ryan = await seedPlayer(db());
  const partner = await seedPlayer(db());
  memberIds.push(ryan, partner);
  const ids: string[] = [];
  for (const [i, c] of [
    SEED_CHORES.trash,
    SEED_CHORES.dishes,
    SEED_CHORES.bathroom,
  ].entries()) {
    const { choreId } = await seedChore(db(), { ...c, householdId });
    const r = await withTransaction((tx) =>
      logCompletion(tx as unknown as Queryable, {
        householdId,
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: T0,
        now: T0,
        source: "ui",
        clientRequestId: `sweep-race-${householdId}-${i}`,
      }),
    );
    if (!r.ok) throw new Error(`log failed: ${r.code}`);
    ids.push(r.completion.id);
  }
  const d = await withTransaction((tx) =>
    applyCompletionEvent(tx as unknown as Queryable, {
      householdId,
      completionId: ids[2]!,
      event: { type: "dispute", actor: partner, reason: "not done" },
      now: new Date(T0.getTime() + HOUR),
    }),
  );
  if (!d.ok) throw new Error(`dispute failed: ${d.code}`);
  return { householdId, ryan, partner, ids };
}

describe("the daily job under concurrency", () => {
  it("two settles at once persist each transition once", async () => {
    const { householdId, ids } = await arrange();
    const now = new Date(T0.getTime() + 30 * HOUR);
    const runs = await Promise.all(
      [0, 1, 2].map(() =>
        withTransaction((tx) =>
          settleDueCompletions(tx as unknown as Queryable, now, {
            householdId,
          }),
        ),
      ),
    );
    const sum = (k: "finalized" | "timedOut") =>
      runs.reduce((n, r) => n + r[k], 0);
    expect(sum("finalized")).toBe(2);
    expect(sum("timedOut")).toBe(1);
    const disputes = await db()
      .select()
      .from(schema.disputes)
      .where(eq(schema.disputes.completionId, ids[2]!));
    expect(disputes.map((x) => x.resolution)).toEqual(["expired"]);
  });

  it("two closes at once close the season once", async () => {
    const { householdId, ryan } = await arrange();
    const runs = await Promise.all(
      [0, 1].map(() =>
        withTransaction((tx) =>
          closeDueSeasons(tx as unknown as Queryable, CLOSABLE, {
            householdId,
          }),
        ),
      ),
    );
    expect(runs.flat()).toEqual([
      expect.objectContaining({ status: "closed", winnerMemberId: ryan }),
    ]);
  });

  it("a close waits out an adjustment being approved, then counts it", async () => {
    const { householdId, ryan, partner } = await arrange();
    const season = (await findSeason(db(), householdId, 2026))!;
    // Ryan has 30 (Trash 20 + Dishes 10); 40 for the partner overtakes him.
    const adj = await createAdjustment(db(), {
      seasonId: season.id,
      memberId: partner,
      points: 40,
      reason: "the move",
      createdBy: ryan,
      now: T0,
    });
    const [, skipped] = await Promise.all([
      withTransaction(async (tx) => {
        const q = tx as unknown as Queryable;
        await lockSeasonShared(q, season.id);
        await q.execute(sql`select pg_sleep(0.5)`);
        await approveAdjustment(q, {
          adjustmentId: adj.id,
          approvedBy: partner,
          now: T0,
        });
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 150));
        return withTransaction((tx) =>
          closeDueSeasons(tx as unknown as Queryable, CLOSABLE, {
            householdId,
          }),
        );
      })(),
    ]);
    expect(skipped).toEqual([]);
    const closed = await withTransaction((tx) =>
      closeDueSeasons(tx as unknown as Queryable, CLOSABLE, { householdId }),
    );
    expect(closed).toEqual([
      expect.objectContaining({ status: "closed", winnerMemberId: partner }),
    ]);
  });
});
