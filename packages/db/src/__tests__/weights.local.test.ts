import { berlinWallTimeToUtc } from "@baumy/core";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { lockChoreRow } from "../chores";
import { logCompletion } from "../completions";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import * as schema from "../schema";
import {
  applyDueSuggestions,
  computeSuggestions,
  lockSuggestion,
  scheduleSuggestion,
  vetoSuggestion,
} from "../weights";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";

// The weekly compute and the apply against each other and against a veto, on
// Docker Postgres (PGlite serialises every transaction and cannot race).
// SPEC §6.7: every job is idempotent and safe against double claims. Each
// test runs in a household of its own on the shared local database.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = berlinWallTimeToUtc(2026, 9, 28, 4);
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
    .delete(schema.weightSuggestions)
    .where(inArray(schema.weightSuggestions.householdId, households));
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

/** A household with Trash at 15 done every 4 days: E8's suggestion of 19. */
async function arrange() {
  const [household] = await db()
    .insert(schema.households)
    .values({ name: "Weights race" })
    .returning({ id: schema.households.id });
  const householdId = household!.id;
  households.push(householdId);
  const ryan = await seedPlayer(db());
  const partner = await seedPlayer(db());
  memberIds.push(ryan, partner);
  const { choreId } = await seedChore(db(), {
    ...SEED_CHORES.trash,
    basePoints: 15,
    householdId,
  });
  for (let i = 0; i < 8; i += 1) {
    const at = new Date(NOW.getTime() - 25 * HOUR - (7 - i) * 4 * DAY);
    const r = await withTransaction((tx) =>
      logCompletion(tx as unknown as Queryable, {
        householdId,
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: at,
        now: at,
        source: "ui",
        clientRequestId: `weights-race-${householdId}-${i}`,
      }),
    );
    if (!r.ok) throw new Error(`log failed: ${r.code}`);
  }
  return { householdId, choreId, ryan, partner };
}

describe("weights under concurrency", () => {
  it("two computes in the same week store one suggestion", async () => {
    const { householdId, choreId } = await arrange();
    const [a, b] = await Promise.all([
      withTransaction((tx) =>
        computeSuggestions(tx as unknown as Queryable, NOW, { householdId }),
      ),
      withTransaction((tx) =>
        computeSuggestions(tx as unknown as Queryable, NOW, { householdId }),
      ),
    ]);
    expect(a.suggested.length + b.suggested.length).toBe(1);
    const rows = await db()
      .select()
      .from(schema.weightSuggestions)
      .where(eq(schema.weightSuggestions.choreId, choreId));
    expect(rows.map((r) => [r.status, r.suggestedPoints])).toEqual([
      ["open", 19],
    ]);
  });

  it("a veto racing the apply: exactly one wins, and a vetoed one adds no version", async () => {
    const { householdId, choreId, ryan, partner } = await arrange();
    const { suggested } = await withTransaction((tx) =>
      computeSuggestions(tx as unknown as Queryable, NOW, { householdId }),
    );
    const appliesAt = new Date(NOW.getTime() + 7 * DAY);
    await withTransaction((tx) =>
      scheduleSuggestion(tx as unknown as Queryable, {
        suggestionId: suggested[0]!.id,
        basePoints: 19,
        cooldownMinutes: 48 * 60,
        appliesAt,
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    // The veto's clock is a moment before applies_at, the job's just after:
    // both are plausible at once, and only one may take effect.
    const [applied, vetoed] = await Promise.all([
      withTransaction((tx) =>
        applyDueSuggestions(
          tx as unknown as Queryable,
          new Date(appliesAt.getTime() + 1000),
          { householdId },
        ),
      ),
      withTransaction((tx) =>
        vetoSuggestion(tx as unknown as Queryable, {
          suggestionId: suggested[0]!.id,
          vetoedBy: partner,
          now: new Date(appliesAt.getTime() - 1000),
        }),
      ),
    ]);
    expect(applied.length + (vetoed ? 1 : 0)).toBe(1);
    const [row] = await db()
      .select()
      .from(schema.weightSuggestions)
      .where(eq(schema.weightSuggestions.id, suggested[0]!.id));
    const versions = await db()
      .select()
      .from(schema.choreRuleVersions)
      .where(eq(schema.choreRuleVersions.choreId, choreId));
    const fromSuggestion = versions.filter((v) => v.source === "suggestion");
    if (vetoed) {
      expect(row!.status).toBe("vetoed");
      expect(fromSuggestion).toEqual([]);
    } else {
      expect(row!.status).toBe("applied");
      expect(fromSuggestion).toHaveLength(1);
    }
  });

  it("an apply racing a decision that locks the chore first does not deadlock", async () => {
    const { householdId, choreId, ryan } = await arrange();
    const { suggested } = await withTransaction((tx) =>
      computeSuggestions(tx as unknown as Queryable, NOW, { householdId }),
    );
    const id = suggested[0]!.id;
    const appliesAt = new Date(NOW.getTime() + 7 * DAY);
    await withTransaction((tx) =>
      scheduleSuggestion(tx as unknown as Queryable, {
        suggestionId: id,
        basePoints: 19,
        cooldownMinutes: 48 * 60,
        appliesAt,
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    const at = new Date(appliesAt.getTime() + HOUR);
    // `schedule_weight` from a stale page: the chore, a pause, then the
    // suggestion. An apply that locked the suggestion first would deadlock.
    const [decided, applied] = await Promise.all([
      withTransaction(async (tx) => {
        const q = tx as unknown as Queryable;
        await lockChoreRow(q, householdId, choreId);
        await q.execute(sql`select pg_sleep(0.5)`);
        return lockSuggestion(q, householdId, id);
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 150));
        return withTransaction((tx) =>
          applyDueSuggestions(tx as unknown as Queryable, at, { householdId }),
        );
      })(),
    ]);
    expect(decided?.status).toBe("scheduled");
    expect(applied).toHaveLength(1);
  });

  it("two applies at once add one rule version", async () => {
    const { householdId, choreId, ryan } = await arrange();
    const { suggested } = await withTransaction((tx) =>
      computeSuggestions(tx as unknown as Queryable, NOW, { householdId }),
    );
    const appliesAt = new Date(NOW.getTime() + 7 * DAY);
    await withTransaction((tx) =>
      scheduleSuggestion(tx as unknown as Queryable, {
        suggestionId: suggested[0]!.id,
        basePoints: 19,
        cooldownMinutes: 48 * 60,
        appliesAt,
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    const at = new Date(appliesAt.getTime() + HOUR);
    const [a, b] = await Promise.all([
      withTransaction((tx) =>
        applyDueSuggestions(tx as unknown as Queryable, at, { householdId }),
      ),
      withTransaction((tx) =>
        applyDueSuggestions(tx as unknown as Queryable, at, { householdId }),
      ),
    ]);
    expect(a.length + b.length).toBe(1);
    const versions = await db()
      .select()
      .from(schema.choreRuleVersions)
      .where(eq(schema.choreRuleVersions.choreId, choreId));
    expect(versions.filter((v) => v.source === "suggestion")).toHaveLength(1);
  });
});
