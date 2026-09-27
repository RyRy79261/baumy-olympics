import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { logCompletion } from "../completions";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import * as schema from "../schema";
import { setPrizeMode } from "../scores";
import { ensureSeason } from "../seasons";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";

// set_prize_mode against a completion being logged at the same moment, on
// Docker Postgres (PGlite serialises every transaction and cannot race). The
// mode locks at the season's first completion (SPEC §4.5), so a completion
// that is in flight while the mode is set must either be seen or wait.
//
// It runs in a household of its own, so the shared local database's other
// completions cannot lock this season first.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const NOW = new Date("2026-09-27T10:00:00Z");
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
  await db()
    .delete(schema.completionScores)
    .where(inArray(schema.completionScores.completionId, completionIds));
  await db()
    .delete(schema.completions)
    .where(inArray(schema.completions.householdId, households));
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

describe("setPrizeMode under a concurrent completion", () => {
  it("waits for a completion being logged and then refuses with PRIZE_MODE_LOCKED", async () => {
    const [household] = await db()
      .insert(schema.households)
      .values({ name: "Prize race" })
      .returning({ id: schema.households.id });
    const householdId = household!.id;
    households.push(householdId);
    const ryan = await seedPlayer(db());
    memberIds.push(ryan);
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      name: "Trash",
      householdId,
    });
    const season = await ensureSeason(db(), {
      householdId,
      year: 2026,
      now: NOW,
    });

    // The completion is inserted, then its transaction stays open a moment.
    let logged!: () => void;
    const inFlight = new Promise<void>((resolve) => (logged = resolve));
    const logging = withTransaction(async (tx) => {
      const r = await logCompletion(tx as unknown as Queryable, {
        householdId,
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: NOW,
        now: NOW,
        source: "ui",
        clientRequestId: `prize-race-${householdId}`,
      });
      logged();
      await tx.execute(sql`select pg_sleep(0.5)`);
      return r;
    });

    await inFlight;
    const setting = withTransaction((tx) =>
      setPrizeMode(tx as unknown as Queryable, {
        seasonId: season.id,
        mode: "points",
        lockOnFirstCompletion: true,
      }),
    );
    const [log, prize] = await Promise.all([logging, setting]);
    expect(log.ok).toBe(true);
    expect(prize).toEqual({ ok: false, code: "PRIZE_MODE_LOCKED" });
    const stored = await db()
      .select({ id: schema.completions.id })
      .from(schema.completions)
      .where(eq(schema.completions.seasonId, season.id));
    expect(stored).toHaveLength(1);
  });
});
