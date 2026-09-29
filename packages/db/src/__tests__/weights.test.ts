import {
  FREQUENCY_V1,
  berlinWallTimeToUtc,
  startOfBerlinWeek,
  type WeightSuggestionStatus,
} from "@baumy/core";
import { asc, eq } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import { logCompletion } from "../completions";
import { applyCompletionEvent } from "../confirmations";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  choreRuleVersions,
  chores,
  completionScores,
  completions,
  weightSuggestionStatus,
  weightSuggestions,
} from "../schema";
import {
  applyDueSuggestions,
  computeSuggestions,
  dismissSuggestion,
  findSuggestion,
  insertAdminChange,
  lastAppliedAt,
  listActiveSuggestions,
  listPointsHistory,
  listScheduledChanges,
  listWeightPanel,
  lockActiveSuggestion,
  lockSuggestion,
  measureChore,
  scheduleSuggestion,
  supersedeSuggestion,
  vetoSuggestion,
  type WeightSuggestionRow,
} from "../weights";
import {
  RULES_FROM,
  SEED_CHORES,
  seedChore,
  seedPlayer,
} from "./_game-fixtures";
import { useTestDb } from "./_harness";

// Frequency-derived weights (SPEC §4.4, issue #17) on PGlite: the weekly
// compute, the schedule/dismiss/veto compare-and-sets and the apply.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DAY_MIN = 24 * 60;
/** Monday 28 Sep 2026, 04:00 Berlin: the daily job's time on a Monday. */
const NOW = berlinWallTimeToUtc(2026, 9, 28, 4);
const E7_GAPS = [6, 7, 7, 8, 5, 9, 7, 14, 6, 7, 7, 8];

function tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  return t.db().transaction((q) => fn(q as unknown as Queryable));
}

let reqSeq = 0;

/**
 * Completions `gapsDays` apart by `doers` in turn, the last a day and a bit
 * before `end`, each logged as it happened (so optimistic self-claims have
 * finalized by `end`). Returns the completion ids.
 */
async function logSeries(
  choreId: string,
  doers: string[],
  gapsDays: readonly number[],
  end = NOW,
): Promise<string[]> {
  const total = gapsDays.reduce((a, b) => a + b, 0);
  let when = end.getTime() - 25 * HOUR - total * DAY;
  const ids: string[] = [];
  for (let i = 0; i <= gapsDays.length; i += 1) {
    const doer = doers[i % doers.length]!;
    reqSeq += 1;
    const occurredAt = new Date(when);
    const r = await tx((q) =>
      logCompletion(q, {
        householdId: HOUSEHOLD_ID,
        choreId,
        doneBy: doer,
        loggedBy: doer,
        occurredAt,
        now: occurredAt,
        source: "ui",
        clientRequestId: `weights-${reqSeq}`,
      }),
    );
    if (!r.ok) throw new Error(`log failed: ${r.code}`);
    ids.push(r.completion.id);
    when += (gapsDays[i] ?? 0) * DAY;
  }
  return ids;
}

async function suggestionsOf(choreId: string): Promise<WeightSuggestionRow[]> {
  return t
    .db()
    .select()
    .from(weightSuggestions)
    .where(eq(weightSuggestions.choreId, choreId))
    .orderBy(asc(weightSuggestions.computedAt));
}

async function versionsOf(choreId: string) {
  return t
    .db()
    .select()
    .from(choreRuleVersions)
    .where(eq(choreRuleVersions.choreId, choreId))
    .orderBy(asc(choreRuleVersions.effectiveFrom));
}

async function scoresOf(choreId: string) {
  return t
    .db()
    .select({
      id: completionScores.completionId,
      ruleVersionId: completionScores.ruleVersionId,
      basePts: completionScores.basePts,
      totalPts: completionScores.totalPts,
    })
    .from(completionScores)
    .innerJoin(completions, eq(completions.id, completionScores.completionId))
    .where(eq(completions.choreId, choreId))
    .orderBy(asc(completions.occurredAt));
}

/** A Bathroom at 35 with the E7 history, and its computed suggestion. */
async function e7() {
  const ryan = await seedPlayer(db(), "Ryan");
  const partner = await seedPlayer(db(), "Partner");
  const { choreId } = await seedChore(db(), {
    ...SEED_CHORES.bathroom,
    basePoints: 35,
  });
  await logSeries(choreId, [ryan, partner], E7_GAPS);
  const r = await tx((q) => computeSuggestions(q, NOW));
  const [suggestion] = r.suggested;
  return { ryan, partner, choreId, suggestion: suggestion!, result: r };
}

describe("schema", () => {
  it("mirrors the core status union", () => {
    expectTypeOf<
      (typeof weightSuggestionStatus.enumValues)[number]
    >().toEqualTypeOf<WeightSuggestionStatus>();
    expect(weightSuggestionStatus.enumValues).toContain("vetoed");
  });
});

describe("computeSuggestions", () => {
  it("E7: stores a suggestion of 26 for a Bathroom at 35 with a 7-day median", async () => {
    const { choreId, suggestion, result } = await e7();
    expect(result.measured).toBe(1);
    expect(suggestion).toMatchObject({
      choreId,
      householdId: HOUSEHOLD_ID,
      status: "open",
      weekStart: startOfBerlinWeek(NOW),
      computedAt: NOW,
      windowEnd: NOW,
      medianIntervalMinutes: 7 * DAY_MIN,
      currentPoints: 35,
      currentCooldownMinutes: SEED_CHORES.bathroom.cooldownMinutes,
      suggestedPoints: 26,
      suggestedCooldownMinutes: 3.5 * DAY_MIN,
      appliesAt: null,
    });
    expect(suggestion.rawPoints).toBeCloseTo(26.46, 2);
    expect(suggestion.sampleIntervals).toEqual(E7_GAPS.map((g) => g * DAY_MIN));
    expect(await suggestionsOf(choreId)).toHaveLength(1);
  });

  it("E8: Trash at 15 done every 4 days suggests 19, then nothing at 19", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      basePoints: 15,
    });
    await logSeries(choreId, [ryan], Array(8).fill(4));
    const first = await tx((q) => computeSuggestions(q, NOW));
    expect(first.suggested[0]).toMatchObject({
      rawPoints: 20,
      suggestedPoints: 19,
      suggestedCooldownMinutes: 2 * DAY_MIN,
    });

    // The next cycle, at 19: inside the dead-band, so nothing is stored and
    // the open one is superseded.
    await t
      .db()
      .insert(choreRuleVersions)
      .values({
        choreId,
        effectiveFrom: new Date(NOW.getTime() + HOUR),
        basePoints: 19,
        cooldownMinutes: SEED_CHORES.trash.cooldownMinutes,
        source: "manual",
      });
    const nextWeek = new Date(NOW.getTime() + 7 * DAY);
    const m = await measureChore(
      db(),
      { id: choreId, confirmMode: "optimistic", effortFactorPct: 100 },
      nextWeek,
    );
    expect(m?.verdict).toMatchObject({ kind: "no_change", rawPoints: 20 });
    const second = await tx((q) => computeSuggestions(q, nextWeek));
    expect(second).toEqual({ measured: 1, suggested: [] });
    expect((await suggestionsOf(choreId)).map((s) => s.status)).toEqual([
      "superseded",
    ]);
  });

  it("stores nothing with 5 intervals: insufficient_data", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      basePoints: 15,
    });
    await logSeries(
      choreId,
      [ryan],
      Array(FREQUENCY_V1.minIntervals - 1).fill(4),
    );
    const m = await measureChore(
      db(),
      { id: choreId, confirmMode: "optimistic", effortFactorPct: 100 },
      NOW,
    );
    expect(m?.verdict).toEqual({ kind: "insufficient_data", sampleSize: 5 });
    const r = await tx((q) => computeSuggestions(q, NOW));
    expect(r).toEqual({ measured: 1, suggested: [] });
    expect(await suggestionsOf(choreId)).toEqual([]);
  });

  it("measures only finalized or confirmed claims that were never disputed", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      basePoints: 15,
    });
    const ids = await logSeries(choreId, [ryan], Array(7).fill(4));
    const all = await measureChore(
      db(),
      { id: choreId, confirmMode: "optimistic", effortFactorPct: 100 },
      NOW,
    );
    expect(all?.measurement.intervals).toHaveLength(7);

    // A dispute, even one withdrawn later, takes the claim out for good.
    const disputed = await t
      .db()
      .select()
      .from(completions)
      .where(eq(completions.id, ids[3]!));
    const at = new Date(disputed[0]!.loggedAt.getTime() + HOUR);
    for (const event of [
      { type: "dispute" as const, actor: partner, reason: "Not done" },
      { type: "withdraw" as const, actor: partner },
    ]) {
      const r = await tx((q) =>
        applyCompletionEvent(q, {
          householdId: HOUSEHOLD_ID,
          completionId: ids[3]!,
          event,
          now: at,
        }),
      );
      expect(r.ok).toBe(true);
    }
    const after = await measureChore(
      db(),
      { id: choreId, confirmMode: "optimistic", effortFactorPct: 100 },
      NOW,
    );
    expect(after?.measurement.rawIntervals).toEqual([
      4 * DAY_MIN,
      4 * DAY_MIN,
      8 * DAY_MIN,
      4 * DAY_MIN,
      4 * DAY_MIN,
      4 * DAY_MIN,
    ]);

    // A self-claim still inside its 24h window is not finalized yet.
    reqSeq += 1;
    const fresh = new Date(NOW.getTime() + 23 * HOUR);
    const logged = await tx((q) =>
      logCompletion(q, {
        householdId: HOUSEHOLD_ID,
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: fresh,
        now: fresh,
        source: "ui",
        clientRequestId: `weights-${reqSeq}`,
      }),
    );
    expect(logged.ok).toBe(true);
    const withPending = await measureChore(
      db(),
      { id: choreId, confirmMode: "optimistic", effortFactorPct: 100 },
      new Date(fresh.getTime() + HOUR),
    );
    expect(withPending?.measurement.rawIntervals).toHaveLength(6);
    // Once it finalizes, it counts.
    const later = await measureChore(
      db(),
      { id: choreId, confirmMode: "optimistic", effortFactorPct: 100 },
      new Date(fresh.getTime() + 25 * HOUR),
    );
    expect(later?.measurement.rawIntervals).toHaveLength(7);
  });

  it("runs once per Berlin week and chore, and supersedes last week's open one", async () => {
    const { choreId, suggestion } = await e7();
    // A second run the same week does nothing.
    const again = await tx((q) =>
      computeSuggestions(q, new Date(NOW.getTime() + 2 * DAY)),
    );
    expect(again).toEqual({ measured: 0, suggested: [] });

    const nextWeek = new Date(NOW.getTime() + 7 * DAY);
    const next = await tx((q) => computeSuggestions(q, nextWeek));
    expect(next.suggested).toHaveLength(1);
    expect(next.suggested[0]!.weekStart).toEqual(startOfBerlinWeek(nextWeek));
    const rows = await suggestionsOf(choreId);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [suggestion.id, "superseded"],
      [next.suggested[0]!.id, "open"],
    ]);
  });

  it("leaves a chore with a scheduled change alone, and skips archived chores", async () => {
    const { ryan, choreId, suggestion } = await e7();
    await tx((q) =>
      scheduleSuggestion(q, {
        suggestionId: suggestion.id,
        basePoints: 26,
        cooldownMinutes: 3.5 * DAY_MIN,
        appliesAt: new Date(NOW.getTime() + 7 * DAY),
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    const nextWeek = new Date(NOW.getTime() + 7 * DAY - HOUR);
    const r = await tx((q) =>
      computeSuggestions(q, new Date(nextWeek.getTime() + 2 * HOUR)),
    );
    expect(r.measured).toBe(0);

    await t
      .db()
      .update(chores)
      .set({ archivedAt: NOW })
      .where(eq(chores.id, choreId));
    const none = await tx((q) =>
      computeSuggestions(q, new Date(NOW.getTime() + 21 * DAY)),
    );
    expect(none).toEqual({ measured: 0, suggested: [] });
  });

  it("can be narrowed to one household", async () => {
    const other = "00000000-0000-4000-8000-000000000000";
    const ryan = await seedPlayer(db(), "Ryan");
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      basePoints: 15,
    });
    await logSeries(choreId, [ryan], Array(8).fill(4));
    expect(
      await tx((q) => computeSuggestions(q, NOW, { householdId: other })),
    ).toEqual({ measured: 0, suggested: [] });
    const mine = await tx((q) =>
      computeSuggestions(q, NOW, { householdId: HOUSEHOLD_ID }),
    );
    expect(mine.suggested).toHaveLength(1);
    await tx((q) =>
      scheduleSuggestion(q, {
        suggestionId: mine.suggested[0]!.id,
        basePoints: 19,
        cooldownMinutes: 2 * DAY_MIN,
        appliesAt: new Date(NOW.getTime() + 7 * DAY),
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    const later = new Date(NOW.getTime() + 8 * DAY);
    expect(
      await tx((q) => applyDueSuggestions(q, later, { householdId: other })),
    ).toEqual([]);
    expect(
      await tx((q) =>
        applyDueSuggestions(q, later, { householdId: HOUSEHOLD_ID }),
      ),
    ).toHaveLength(1);
  });

  it("skips a chore with no rule version in effect yet", async () => {
    await seedChore(db(), {
      ...SEED_CHORES.trash,
      effectiveFrom: new Date(NOW.getTime() + DAY),
    });
    expect(await tx((q) => computeSuggestions(q, NOW))).toEqual({
      measured: 0,
      suggested: [],
    });
    const panel = await listWeightPanel(db(), {
      householdId: HOUSEHOLD_ID,
      now: NOW,
    });
    expect(panel).toHaveLength(1);
    expect(panel[0]).toMatchObject({ rule: null, live: null, active: null });
  });
});

describe("schedule, dismiss and veto", () => {
  it("compare-and-sets each decision on the status it expects", async () => {
    const { ryan, partner, suggestion } = await e7();
    const appliesAt = new Date(NOW.getTime() + 7 * DAY);
    const scheduled = await tx((q) =>
      scheduleSuggestion(q, {
        suggestionId: suggestion.id,
        basePoints: 27,
        cooldownMinutes: 80 * 60,
        appliesAt,
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    expect(scheduled).toMatchObject({
      status: "scheduled",
      scheduledPoints: 27,
      scheduledCooldownMinutes: 80 * 60,
      appliesAt,
      scheduledBy: ryan,
      scheduledAt: NOW,
    });
    // Scheduling twice finds it no longer open.
    expect(
      await tx((q) =>
        scheduleSuggestion(q, {
          suggestionId: suggestion.id,
          basePoints: 26,
          cooldownMinutes: 60,
          appliesAt,
          scheduledBy: ryan,
          now: NOW,
        }),
      ),
    ).toBeNull();
    expect(await listScheduledChanges(db(), HOUSEHOLD_ID)).toMatchObject([
      { id: suggestion.id, choreName: "Bathroom" },
    ]);

    // No veto at or after applies_at.
    expect(
      await tx((q) =>
        vetoSuggestion(q, {
          suggestionId: suggestion.id,
          vetoedBy: partner,
          now: appliesAt,
        }),
      ),
    ).toBeNull();
    const vetoed = await tx((q) =>
      vetoSuggestion(q, {
        suggestionId: suggestion.id,
        vetoedBy: partner,
        now: new Date(appliesAt.getTime() - MIN),
      }),
    );
    expect(vetoed).toMatchObject({ status: "vetoed", vetoedBy: partner });
    // Vetoed is final: no dismiss, no second veto.
    expect(
      await tx((q) =>
        dismissSuggestion(q, {
          suggestionId: suggestion.id,
          dismissedBy: ryan,
          now: NOW,
        }),
      ),
    ).toBeNull();
    expect(
      await tx((q) =>
        vetoSuggestion(q, {
          suggestionId: suggestion.id,
          vetoedBy: partner,
          now: NOW,
        }),
      ),
    ).toBeNull();
    expect(await listScheduledChanges(db(), HOUSEHOLD_ID)).toEqual([]);
  });

  it("dismisses an open one, or a scheduled one before it applies", async () => {
    const { ryan, suggestion } = await e7();
    const dismissed = await tx((q) =>
      dismissSuggestion(q, {
        suggestionId: suggestion.id,
        dismissedBy: ryan,
        now: NOW,
      }),
    );
    expect(dismissed).toMatchObject({ status: "dismissed", dismissedBy: ryan });
    // …and the same week does not bring it back.
    expect(
      (await tx((q) => computeSuggestions(q, new Date(NOW.getTime() + DAY))))
        .suggested,
    ).toEqual([]);
  });

  it("finds a suggestion only in its household", async () => {
    const { suggestion } = await e7();
    await expect(
      lockSuggestion(db(), HOUSEHOLD_ID, suggestion.id),
    ).resolves.toMatchObject({ id: suggestion.id });
    await expect(
      findSuggestion(db(), HOUSEHOLD_ID, suggestion.id),
    ).resolves.toMatchObject({ id: suggestion.id });
    await expect(
      findSuggestion(
        db(),
        "00000000-0000-4000-8000-000000000000",
        suggestion.id,
      ),
    ).resolves.toBeNull();
    await expect(
      lockSuggestion(
        db(),
        "00000000-0000-4000-8000-000000000000",
        suggestion.id,
      ),
    ).resolves.toBeNull();
  });
});

describe("applyDueSuggestions", () => {
  async function scheduledE7(appliesAt = new Date(NOW.getTime() + 7 * DAY)) {
    const base = await e7();
    await tx((q) =>
      scheduleSuggestion(q, {
        suggestionId: base.suggestion.id,
        basePoints: base.suggestion.suggestedPoints!,
        cooldownMinutes: base.suggestion.suggestedCooldownMinutes!,
        appliesAt,
        scheduledBy: base.ryan,
        now: NOW,
      }),
    );
    return { ...base, appliesAt };
  }

  it("adds a suggestion rule version from the moment it runs, and changes no past score", async () => {
    const { ryan, choreId, suggestion, appliesAt } = await scheduledE7();
    const before = await scoresOf(choreId);
    expect(before.length).toBeGreaterThan(0);

    // Not before applies_at.
    expect(
      await tx((q) =>
        applyDueSuggestions(q, new Date(appliesAt.getTime() - 1)),
      ),
    ).toEqual([]);

    const runAt = new Date(appliesAt.getTime() + 2 * HOUR);
    const applied = await tx((q) => applyDueSuggestions(q, runAt));
    expect(applied).toEqual([
      {
        suggestionId: suggestion.id,
        choreId,
        ruleVersionId: expect.any(String),
        basePoints: 26,
        cooldownMinutes: 3.5 * DAY_MIN,
      },
    ]);
    const versions = await versionsOf(choreId);
    expect(versions.at(-1)).toMatchObject({
      id: applied[0]!.ruleVersionId,
      effectiveFrom: runAt,
      basePoints: 26,
      cooldownMinutes: 3.5 * DAY_MIN,
      source: "suggestion",
      suggestionId: suggestion.id,
      createdBy: ryan,
    });
    expect(await scoresOf(choreId)).toEqual(before);
    const [row] = await suggestionsOf(choreId);
    expect(row).toMatchObject({ status: "applied", appliedAt: runAt });
    expect(await lastAppliedAt(db(), choreId)).toEqual(appliesAt);

    // Idempotent: a second run applies nothing more.
    expect(
      await tx((q) => applyDueSuggestions(q, new Date(runAt.getTime() + HOUR))),
    ).toEqual([]);
    expect(await versionsOf(choreId)).toHaveLength(versions.length);

    // The next completion scores at the new weight.
    reqSeq += 1;
    const next = new Date(runAt.getTime() + HOUR);
    const logged = await tx((q) =>
      logCompletion(q, {
        householdId: HOUSEHOLD_ID,
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: next,
        now: next,
        source: "ui",
        clientRequestId: `weights-${reqSeq}`,
      }),
    );
    expect(logged.ok && logged.score?.basePts).toBe(26);
  });

  it("re-scores a completion already logged a minute into the future", async () => {
    const { ryan, choreId, appliesAt } = await scheduledE7();
    const runAt = new Date(appliesAt.getTime() + 2 * HOUR);
    reqSeq += 1;
    const ahead = new Date(runAt.getTime() + MIN);
    const logged = await tx((q) =>
      logCompletion(q, {
        householdId: HOUSEHOLD_ID,
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: ahead,
        now: runAt,
        source: "ui",
        clientRequestId: `weights-${reqSeq}`,
      }),
    );
    expect(logged.ok && logged.score?.basePts).toBe(35);
    await tx((q) => applyDueSuggestions(q, runAt));
    expect((await scoresOf(choreId)).at(-1)?.basePts).toBe(26);
  });

  it("never applies a vetoed suggestion", async () => {
    const { partner, choreId, suggestion, appliesAt } = await scheduledE7();
    await tx((q) =>
      vetoSuggestion(q, {
        suggestionId: suggestion.id,
        vetoedBy: partner,
        now: new Date(appliesAt.getTime() - DAY),
      }),
    );
    const versions = await versionsOf(choreId);
    expect(
      await tx((q) =>
        applyDueSuggestions(q, new Date(appliesAt.getTime() + 30 * DAY)),
      ),
    ).toEqual([]);
    expect(await versionsOf(choreId)).toEqual(versions);
    expect((await suggestionsOf(choreId))[0]!.status).toBe("vetoed");
  });

  it("keeps a change within 28 days of the last one scheduled", async () => {
    const { ryan, choreId, appliesAt } = await scheduledE7();
    const runAt = new Date(appliesAt.getTime() + HOUR);
    expect(await tx((q) => applyDueSuggestions(q, runAt))).toHaveLength(1);

    // A second suggestion forced onto the Monday a week later (the schedule
    // itself would never pick it).
    const [second] = await t
      .db()
      .insert(weightSuggestions)
      .values({
        householdId: HOUSEHOLD_ID,
        choreId,
        weekStart: startOfBerlinWeek(runAt),
        computedAt: runAt,
        windowStart: NOW,
        windowEnd: runAt,
        sampleIntervals: [],
        medianIntervalMinutes: DAY_MIN,
        rawPoints: 10,
        currentPoints: 26,
        currentCooldownMinutes: 3.5 * DAY_MIN,
        suggestedPoints: 20,
        suggestedCooldownMinutes: 12 * 60,
        status: "scheduled",
        scheduledPoints: 20,
        scheduledCooldownMinutes: 12 * 60,
        appliesAt: new Date(appliesAt.getTime() + 7 * DAY),
        scheduledBy: ryan,
        scheduledAt: runAt,
      })
      .returning();
    const later = new Date(appliesAt.getTime() + 8 * DAY);
    expect(await tx((q) => applyDueSuggestions(q, later))).toEqual([]);
    const [row] = await t
      .db()
      .select()
      .from(weightSuggestions)
      .where(eq(weightSuggestions.id, second!.id));
    expect(row!.status).toBe("scheduled");
  });
});

describe("listWeightPanel", () => {
  it("shows each chore's weight, live measurement and waiting suggestion", async () => {
    const { choreId, suggestion } = await e7();
    await seedChore(db(), SEED_CHORES.dishes);
    const panel = await listWeightPanel(db(), {
      householdId: HOUSEHOLD_ID,
      now: NOW,
    });
    expect(panel.map((p) => p.choreName)).toEqual(["Bathroom", "Dishes"]);
    expect(panel[0]).toMatchObject({
      choreId,
      effortFactorPct: 100,
      rule: {
        basePoints: 35,
        cooldownMinutes: SEED_CHORES.bathroom.cooldownMinutes,
      },
      active: { id: suggestion.id, status: "open" },
      lastAppliedAt: null,
    });
    expect(panel[0]!.live?.verdict).toMatchObject({
      kind: "suggest",
      suggestedPoints: 26,
    });
    expect(panel[1]).toMatchObject({
      active: null,
      live: { verdict: { kind: "insufficient_data", sampleSize: 0 } },
    });
  });
});

describe("listActiveSuggestions", () => {
  it("lists the open and scheduled suggestions of the household only", async () => {
    const { ryan, choreId, suggestion } = await e7();
    await expect(listActiveSuggestions(db(), HOUSEHOLD_ID)).resolves.toEqual([
      expect.objectContaining({ id: suggestion.id, choreId, status: "open" }),
    ]);
    await tx((q) =>
      scheduleSuggestion(q, {
        suggestionId: suggestion.id,
        basePoints: 27,
        cooldownMinutes: 80 * 60,
        appliesAt: new Date(NOW.getTime() + 7 * DAY),
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    await expect(listActiveSuggestions(db(), HOUSEHOLD_ID)).resolves.toEqual([
      expect.objectContaining({ id: suggestion.id, status: "scheduled" }),
    ]);
    await expect(
      listActiveSuggestions(db(), "00000000-0000-4000-8000-000000000000"),
    ).resolves.toEqual([]);
    await tx((q) =>
      dismissSuggestion(q, {
        suggestionId: suggestion.id,
        dismissedBy: ryan,
        now: NOW,
      }),
    );
    await expect(listActiveSuggestions(db(), HOUSEHOLD_ID)).resolves.toEqual(
      [],
    );
  });
});

describe("an admin's points change (issue #115)", () => {
  /** An admin's change to `choreId`, 35 → `to`, applying a week out. */
  function adminChange(
    choreId: string,
    by: string,
    over: Partial<Parameters<typeof insertAdminChange>[1]> = {},
  ) {
    return tx((q) =>
      insertAdminChange(q, {
        householdId: HOUSEHOLD_ID,
        choreId,
        currentPoints: 35,
        currentCooldownMinutes: SEED_CHORES.bathroom.cooldownMinutes,
        basePoints: 50,
        cooldownMinutes: 2 * DAY_MIN,
        reason: "It takes an hour",
        appliesAt: new Date(NOW.getTime() + 7 * DAY),
        scheduledBy: by,
        now: NOW,
        ...over,
      }),
    );
  }

  async function bathroom() {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.bathroom,
      basePoints: 35,
    });
    return { ryan, partner, choreId };
  }

  it("is stored scheduled, without a measurement, as the chore's one active change", async () => {
    const { ryan, choreId } = await bathroom();
    const row = await adminChange(choreId, ryan);
    expect(row).toMatchObject({
      origin: "admin",
      status: "scheduled",
      weekStart: startOfBerlinWeek(NOW),
      currentPoints: 35,
      scheduledPoints: 50,
      scheduledCooldownMinutes: 2 * DAY_MIN,
      reason: "It takes an hour",
      scheduledBy: ryan,
      scheduledAt: NOW,
      medianIntervalMinutes: null,
      suggestedPoints: null,
    });
    await expect(
      tx((q) => lockActiveSuggestion(q, choreId)),
    ).resolves.toMatchObject({ id: row.id });
    // A second one while it waits breaks the one-active index.
    await expect(adminChange(choreId, ryan)).rejects.toThrow();
    // A measured row still needs its measurement (the check).
    await expect(
      t
        .db()
        .insert(weightSuggestions)
        .values({
          householdId: HOUSEHOLD_ID,
          choreId,
          weekStart: startOfBerlinWeek(NOW),
          computedAt: NOW,
          currentPoints: 35,
          currentCooldownMinutes: 60,
          status: "dismissed",
          dismissedBy: ryan,
          dismissedAt: NOW,
        }),
    ).rejects.toThrow();
  });

  it("supersedes an open suggestion only while it is open", async () => {
    const { ryan, suggestion } = await e7();
    await expect(
      tx((q) => supersedeSuggestion(q, suggestion.id)),
    ).resolves.toMatchObject({ status: "superseded" });
    await expect(
      tx((q) => supersedeSuggestion(q, suggestion.id)),
    ).resolves.toBeNull();
    expect(ryan).toBeTruthy();
  });

  it("keeps the weekly compute away while scheduled, but not after a veto the same week", async () => {
    const { ryan, partner, choreId } = await bathroom();
    await logSeries(choreId, [ryan, partner], E7_GAPS);
    const row = await adminChange(choreId, ryan, {
      now: new Date(NOW.getTime() - HOUR),
    });
    expect(await tx((q) => computeSuggestions(q, NOW))).toEqual({
      measured: 0,
      suggested: [],
    });
    await tx((q) =>
      vetoSuggestion(q, { suggestionId: row.id, vetoedBy: partner, now: NOW }),
    );
    // The admin row shares the week, but only a measured one counts.
    const r = await tx((q) => computeSuggestions(q, NOW));
    expect(r.suggested).toHaveLength(1);
    expect(r.suggested[0]).toMatchObject({
      origin: "measured",
      weekStart: startOfBerlinWeek(NOW),
      suggestedPoints: 26,
    });
  });

  it("applies without the 28-day spacing", async () => {
    const { ryan, partner, choreId, suggestion } = await e7();
    const appliesAt = new Date(NOW.getTime() + 7 * DAY);
    await tx((q) =>
      scheduleSuggestion(q, {
        suggestionId: suggestion.id,
        basePoints: 26,
        cooldownMinutes: 3.5 * DAY_MIN,
        appliesAt,
        scheduledBy: ryan,
        now: NOW,
      }),
    );
    const runAt = new Date(appliesAt.getTime() + HOUR);
    expect(await tx((q) => applyDueSuggestions(q, runAt))).toHaveLength(1);
    const admin = await adminChange(choreId, partner, {
      currentPoints: 26,
      appliesAt: new Date(appliesAt.getTime() + 7 * DAY),
      now: runAt,
    });
    const later = new Date(appliesAt.getTime() + 8 * DAY);
    const applied = await tx((q) => applyDueSuggestions(q, later));
    expect(applied).toEqual([
      expect.objectContaining({ suggestionId: admin.id, basePoints: 50 }),
    ]);
    const versions = await versionsOf(choreId);
    expect(versions.at(-1)).toMatchObject({
      source: "suggestion",
      suggestionId: admin.id,
      basePoints: 50,
      createdBy: partner,
    });
  });

  it("reads back every change with who, from, to, why, when and what became of it", async () => {
    const { ryan, partner, choreId } = await bathroom();
    const other = await seedChore(db(), SEED_CHORES.dishes);
    // The seed's createdAt is the database's clock; pin it for the order.
    await t
      .db()
      .update(choreRuleVersions)
      .set({ createdAt: RULES_FROM })
      .where(eq(choreRuleVersions.choreId, choreId));
    const at = (days: number) => new Date(NOW.getTime() + days * DAY);

    // 1. Cancelled by an admin.
    const cancelled = await adminChange(choreId, ryan, { now: at(0) });
    await tx((q) =>
      dismissSuggestion(q, {
        suggestionId: cancelled.id,
        dismissedBy: ryan,
        now: at(1),
      }),
    );
    // 2. Vetoed by the partner.
    const vetoed = await adminChange(choreId, ryan, {
      basePoints: 60,
      reason: null,
      now: at(2),
      appliesAt: at(7),
    });
    await tx((q) =>
      vetoSuggestion(q, {
        suggestionId: vetoed.id,
        vetoedBy: partner,
        now: at(3),
      }),
    );
    // 3. Landed.
    const landed = await adminChange(choreId, ryan, {
      basePoints: 40,
      reason: "Fair",
      now: at(4),
      appliesAt: at(14),
    });
    await tx((q) => applyDueSuggestions(q, at(14)));
    // 4. Waiting.
    const pending = await adminChange(choreId, ryan, {
      currentPoints: 40,
      basePoints: 45,
      reason: null,
      now: at(15),
      appliesAt: at(21),
    });

    const history = await listPointsHistory(db(), {
      householdId: HOUSEHOLD_ID,
      choreId,
    });
    const ryanP = { memberId: ryan, displayName: "Ryan" };
    const partnerP = { memberId: partner, displayName: "Partner" };
    expect(history).toEqual([
      expect.objectContaining({
        key: `s:${pending.id}`,
        source: "admin",
        outcome: "pending",
        suggestionId: pending.id,
        proposedBy: ryanP,
        proposedAt: at(15),
        fromPoints: 40,
        toPoints: 45,
        appliesAt: at(21),
        decidedBy: null,
      }),
      expect.objectContaining({
        source: "admin",
        outcome: "landed",
        suggestionId: landed.id,
        proposedBy: ryanP,
        proposedAt: at(4),
        fromPoints: 35,
        fromCooldownMinutes: SEED_CHORES.bathroom.cooldownMinutes,
        toPoints: 40,
        toCooldownMinutes: 2 * DAY_MIN,
        reason: "Fair",
        appliesAt: at(14),
      }),
      expect.objectContaining({
        key: `s:${vetoed.id}`,
        outcome: "vetoed",
        toPoints: 60,
        reason: null,
        decidedBy: partnerP,
        decidedAt: at(3),
      }),
      expect.objectContaining({
        key: `s:${cancelled.id}`,
        outcome: "cancelled",
        fromPoints: 35,
        toPoints: 50,
        reason: "It takes an hour",
        decidedBy: ryanP,
        decidedAt: at(1),
      }),
      expect.objectContaining({
        source: "seed",
        outcome: "landed",
        proposedBy: null,
        fromPoints: null,
        toPoints: 35,
        appliesAt: RULES_FROM,
      }),
    ]);

    // Without a chore: every bounty's, the other's seed too.
    const all = await listPointsHistory(db(), { householdId: HOUSEHOLD_ID });
    expect(all).toHaveLength(6);
    expect(all.map((e) => e.choreId)).toContain(other.choreId);
    await expect(
      listPointsHistory(db(), {
        householdId: "00000000-0000-4000-8000-000000000000",
      }),
    ).resolves.toEqual([]);
  });

  it("leaves out a suggestion nobody scheduled, and names a manual change's admin", async () => {
    const { ryan, choreId, suggestion } = await e7();
    await tx((q) =>
      dismissSuggestion(q, {
        suggestionId: suggestion.id,
        dismissedBy: ryan,
        now: NOW,
      }),
    );
    await t
      .db()
      .update(choreRuleVersions)
      .set({ createdAt: RULES_FROM })
      .where(eq(choreRuleVersions.choreId, choreId));
    await t.db().insert(choreRuleVersions).values({
      choreId,
      effectiveFrom: NOW,
      basePoints: 30,
      cooldownMinutes: 60,
      source: "manual",
      createdBy: ryan,
      createdAt: NOW,
    });
    const history = await listPointsHistory(db(), {
      householdId: HOUSEHOLD_ID,
      choreId,
    });
    expect(history.map((e) => e.source)).toEqual(["manual", "seed"]);
    expect(history[0]).toMatchObject({
      proposedBy: { memberId: ryan, displayName: "Ryan" },
      fromPoints: 35,
      toPoints: 30,
      toCooldownMinutes: 60,
      suggestionId: null,
    });
  });
});
