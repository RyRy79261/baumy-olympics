// @vitest-environment node
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  berlinWallTimeToUtc,
  nextBerlinMonday,
  weightChangeAppliesAt,
} from "@baumy/core";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import {
  auditEvents,
  choreRuleVersions,
  chores,
  completionScores,
  completions,
  weightSuggestions,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { applyDueSuggestions, computeSuggestions } from "@baumy/db/weights";
import {
  FIXED_NOW,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { RequestCtx } from "./define";
import { runAction } from "./registry";

// get_weights, schedule_weight, dismiss_weight and veto_weight through the
// real runAction on PGlite (issue #17): success, every error code, the
// surfaces and the permissions, and the acceptance criteria end to end
// (E7 through the action, a veto never applies, an applied change keeps past
// scores).

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DAY_MIN = 24 * 60;
const E7_GAPS = [6, 7, 7, 8, 5, 9, 7, 14, 6, 7, 7, 8];
const BATHROOM = SEED_CHORES.bathroom;

beforeEach(() => {
  __resetMemoryRateLimits();
});

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

function kiosk(memberId: string): Actor {
  return { kind: "kiosk", deviceId: "dev-1", memberId, displayName: "K" };
}
function mcp(memberId: string): Actor {
  return { kind: "mcp", memberId, scopes: ["baumy:read", "baumy:write"] };
}
function brain(memberId: string): Actor {
  return { kind: "service", tokenName: "baumy-brain", memberId };
}

let adminA: string;
let adminB: string;
let partner: string;
let bathroom: string;

const as = (member: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(member), over);
const asAdmin = (member: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(member, "admin"), over);

function tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  return t.db().transaction((q) => fn(q as unknown as Queryable));
}

/**
 * E7's Bathroom history through `log_completion`, each logged as it
 * happened, the last a day and a bit before FIXED_NOW (so all have
 * finalized), then this week's suggestion computed. Returns its id.
 */
async function e7Suggestion(): Promise<string> {
  const total = E7_GAPS.reduce((a, b) => a + b, 0);
  let when = FIXED_NOW.getTime() - 25 * HOUR - total * DAY;
  for (let i = 0; i <= E7_GAPS.length; i += 1) {
    const doer = i % 2 === 0 ? adminA : partner;
    const at = new Date(when);
    ok(
      await runAction(
        "log_completion",
        { choreId: bathroom },
        as(doer, { now: at }),
      ),
    );
    when += (E7_GAPS[i] ?? 0) * DAY;
  }
  const { suggested } = await tx((q) => computeSuggestions(q, FIXED_NOW));
  expect(suggested).toHaveLength(1);
  return suggested[0]!.id;
}

async function suggestionRow(id: string) {
  const [row] = await t
    .db()
    .select()
    .from(weightSuggestions)
    .where(eq(weightSuggestions.id, id));
  return row!;
}

async function scores() {
  return t
    .db()
    .select({
      id: completionScores.completionId,
      basePts: completionScores.basePts,
      totalPts: completionScores.totalPts,
    })
    .from(completionScores)
    .innerJoin(completions, eq(completions.id, completionScores.completionId))
    .orderBy(asc(completions.occurredAt));
}

beforeEach(async () => {
  adminA = await seedMember(db(), { displayName: "Admin A", role: "admin" });
  adminB = await seedMember(db(), { displayName: "Admin B", role: "admin" });
  partner = await seedMember(db(), { displayName: "Partner" });
  ({ choreId: bathroom } = await seedChore(db(), {
    ...BATHROOM,
    basePoints: 35,
  }));
});

describe("get_weights", () => {
  it("E7: shows current 35, raw 26.46, suggested 26, the sample and the gaps", async () => {
    const id = await e7Suggestion();
    const data = ok(await runAction("get_weights", {}, as(partner)));
    expect(data.chores).toHaveLength(1);
    const row = data.chores[0]!;
    expect(row).toMatchObject({
      choreId: bathroom,
      choreName: BATHROOM.name,
      effortFactorPct: 100,
      current: { basePoints: 35, cooldownMinutes: BATHROOM.cooldownMinutes },
      // Measured live against the stored median of 7 days, the window is
      // now the 90-day floor (not 8 × the 12.25 days that 35 points imply),
      // so the oldest gap has left it.
      live: {
        verdict: "suggest",
        sampleSize: 11,
        intervals: E7_GAPS.slice(1).map((g) => g * DAY_MIN),
        medianMinutes: 7 * DAY_MIN,
        suggestedPoints: 26,
        suggestedCooldownMinutes: 3.5 * DAY_MIN,
      },
      suggestion: {
        id,
        status: "open",
        currentPoints: 35,
        suggestedPoints: 26,
        suggestedCooldownMinutes: 3.5 * DAY_MIN,
        medianIntervalMinutes: 7 * DAY_MIN,
        sampleIntervals: E7_GAPS.map((g) => g * DAY_MIN),
        appliesAt: null,
      },
      lastAppliedAt: null,
    });
    expect(row.live!.rawPoints).toBeCloseTo(26.46, 2);
    expect(data.scheduled).toEqual([]);
  });

  it("says insufficient_data with 5 intervals, and nothing is stored", async () => {
    let when = FIXED_NOW.getTime() - 25 * HOUR - 5 * 7 * DAY;
    for (let i = 0; i < 6; i += 1) {
      ok(
        await runAction(
          "log_completion",
          { choreId: bathroom },
          as(partner, { now: new Date(when) }),
        ),
      );
      when += 7 * DAY;
    }
    const { suggested } = await tx((q) => computeSuggestions(q, FIXED_NOW));
    expect(suggested).toEqual([]);
    const data = ok(await runAction("get_weights", {}, as(partner)));
    expect(data.chores[0]!.live).toMatchObject({
      verdict: "insufficient_data",
      sampleSize: 5,
      medianMinutes: null,
      rawPoints: null,
      suggestedPoints: null,
    });
    expect(data.chores[0]!.suggestion).toBeNull();
  });

  it("shows a chore with no weight in effect yet without a measurement", async () => {
    await seedChore(db(), {
      ...SEED_CHORES.trash,
      effectiveFrom: new Date(FIXED_NOW.getTime() + DAY),
    });
    const data = ok(await runAction("get_weights", {}, as(partner)));
    expect(data.chores.find((c) => c.choreName === "Trash")).toMatchObject({
      current: null,
      live: null,
    });
  });

  it("lists scheduled changes, and who may veto them", async () => {
    const id = await e7Suggestion();
    ok(
      await runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    );
    const mine = ok(await runAction("get_weights", {}, asAdmin(adminA)));
    expect(mine.scheduled).toMatchObject([
      { id, choreName: BATHROOM.name, canVeto: false, scheduledBy: adminA },
    ]);
    const theirs = ok(await runAction("get_weights", {}, as(partner)));
    expect(theirs.scheduled).toMatchObject([{ id, canVeto: true }]);
    // The veto list alone, without measuring every chore.
    const only = ok(
      await runAction("get_weights", { scheduledOnly: true }, as(partner)),
    );
    expect(only).toMatchObject({
      chores: [],
      scheduled: [{ id, choreName: BATHROOM.name, canVeto: true }],
    });
  });

  it("is only in the UI", async () => {
    for (const [actor, source] of [
      [kiosk(partner), "kiosk"],
      [sessionActor(partner), "ai"],
      [mcp(partner), "mcp"],
      [brain(partner), "brain"],
    ] as [Actor, RequestCtx["source"]][]) {
      await expect(
        runAction("get_weights", {}, ctxFor(actor, { source })),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
  });
});

describe("schedule_weight", () => {
  it("schedules the suggestion for the next Monday 00:00 Berlin at least 48h ahead", async () => {
    const id = await e7Suggestion();
    // FIXED_NOW is Sunday 27 Sep 12:00 Berlin: Monday 28 Sep is under 48h
    // away, so it is Monday 5 Oct.
    const expected = berlinWallTimeToUtc(2026, 10, 5);
    expect(
      weightChangeAppliesAt({ now: FIXED_NOW, lastAppliedAt: null }),
    ).toEqual(expected);
    const data = ok(
      await runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    );
    expect(data).toEqual({
      suggestionId: id,
      choreId: bathroom,
      status: "scheduled",
      appliesAt: expected.toISOString(),
      basePoints: 26,
      cooldownMinutes: 3.5 * DAY_MIN,
    });
    expect(await suggestionRow(id)).toMatchObject({
      status: "scheduled",
      scheduledBy: adminA,
      scheduledAt: FIXED_NOW,
      appliesAt: expected,
    });
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "schedule_weight"));
    expect(audits.map((a) => [a.actorMemberId, a.entity, a.entityId])).toEqual([
      [adminA, "weight_suggestion", id],
    ]);
  });

  it("edits the points and cooldown before scheduling", async () => {
    const id = await e7Suggestion();
    const data = ok(
      await runAction(
        "schedule_weight",
        { suggestionId: id, basePoints: "28", cooldownHours: "72" },
        asAdmin(adminA),
      ),
    );
    expect(data).toMatchObject({ basePoints: 28, cooldownMinutes: 72 * 60 });
    // The suggestion itself keeps what the formula said.
    expect(await suggestionRow(id)).toMatchObject({
      suggestedPoints: 26,
      scheduledPoints: 28,
      scheduledCooldownMinutes: 72 * 60,
    });
  });

  it("rejects points out of range inline", async () => {
    const id = await e7Suggestion();
    await expect(
      runAction(
        "schedule_weight",
        { suggestionId: id, basePoints: "0" },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await suggestionRow(id)).status).toBe("open");
  });

  it("refuses an unknown, already scheduled or superseded suggestion", async () => {
    await expect(
      runAction(
        "schedule_weight",
        { suggestionId: "00000000-0000-4000-8000-000000000000" },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    const id = await e7Suggestion();
    ok(
      await runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    );
    await expect(
      runAction("schedule_weight", { suggestionId: id }, asAdmin(adminB)),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message: "That change is already scheduled.",
    });
  });

  it("refuses an archived chore", async () => {
    const id = await e7Suggestion();
    await t
      .db()
      .update(chores)
      .set({ archivedAt: FIXED_NOW })
      .where(eq(chores.id, bathroom));
    await expect(
      runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    ).resolves.toMatchObject({ ok: false, code: "ARCHIVED_CHORE" });
  });

  it("refuses a suggestion made for points that have since changed", async () => {
    const id = await e7Suggestion();
    ok(
      await runAction(
        "manage_chore",
        {
          op: "update",
          choreId: bathroom,
          name: BATHROOM.name,
          basePoints: 30,
          cooldownHours: BATHROOM.cooldownMinutes / 60,
          proofMode: "none",
          confirmMode: "optimistic",
          effortFactorPct: 100,
        },
        asAdmin(adminA, { now: new Date(FIXED_NOW.getTime() - MIN) }),
      ),
    );
    await expect(
      runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("waits 28 days after the chore's last applied change", async () => {
    const first = await e7Suggestion();
    ok(
      await runAction(
        "schedule_weight",
        { suggestionId: first },
        asAdmin(adminA),
      ),
    );
    const appliedAt = berlinWallTimeToUtc(2026, 10, 5);
    await tx((q) =>
      applyDueSuggestions(q, new Date(appliedAt.getTime() + HOUR)),
    );
    // The Monday after, a new suggestion. The history says 26 is right, so
    // the weekly compute would not make one: store it directly.
    const nextMonday = nextBerlinMonday(appliedAt);
    const [second] = await t
      .db()
      .insert(weightSuggestions)
      .values({
        householdId: (await suggestionRow(first)).householdId,
        choreId: bathroom,
        weekStart: nextMonday,
        computedAt: nextMonday,
        windowStart: FIXED_NOW,
        windowEnd: nextMonday,
        sampleIntervals: [],
        medianIntervalMinutes: DAY_MIN,
        rawPoints: 10,
        currentPoints: 26,
        currentCooldownMinutes: 3.5 * DAY_MIN,
        suggestedPoints: 20,
        suggestedCooldownMinutes: 12 * 60,
      })
      .returning();
    const data = ok(
      await runAction(
        "schedule_weight",
        { suggestionId: second!.id },
        asAdmin(adminA, { now: new Date(nextMonday.getTime() + 2 * HOUR) }),
      ),
    );
    // Not 19 Oct (the 48h rule), but 2 Nov: 28 days after 5 Oct.
    expect(data.appliesAt).toBe(berlinWallTimeToUtc(2026, 11, 2).toISOString());
  });
});

describe("dismiss_weight", () => {
  it("dismisses an open suggestion", async () => {
    const id = await e7Suggestion();
    const data = ok(
      await runAction("dismiss_weight", { suggestionId: id }, asAdmin(adminB)),
    );
    expect(data).toMatchObject({ status: "dismissed", appliesAt: null });
    expect(await suggestionRow(id)).toMatchObject({
      status: "dismissed",
      dismissedBy: adminB,
    });
    await expect(
      runAction("dismiss_weight", { suggestionId: id }, asAdmin(adminB)),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message: "That suggestion was dismissed.",
    });
    await expect(
      runAction("schedule_weight", { suggestionId: id }, asAdmin(adminB)),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("cancels a scheduled change until it is due", async () => {
    const id = await e7Suggestion();
    const scheduled = ok(
      await runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    );
    const due = new Date(scheduled.appliesAt!);
    await expect(
      runAction(
        "dismiss_weight",
        { suggestionId: id },
        asAdmin(adminA, { now: due }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "WINDOW_CLOSED" });
    ok(
      await runAction(
        "dismiss_weight",
        { suggestionId: id },
        asAdmin(adminA, { now: new Date(due.getTime() - MIN) }),
      ),
    );
    expect(
      await tx((q) => applyDueSuggestions(q, new Date(due.getTime() + DAY))),
    ).toEqual([]);
  });

  it("refuses an unknown suggestion", async () => {
    await expect(
      runAction(
        "dismiss_weight",
        { suggestionId: "00000000-0000-4000-8000-000000000000" },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("veto_weight", () => {
  async function scheduled() {
    const id = await e7Suggestion();
    const data = ok(
      await runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    );
    return { id, appliesAt: new Date(data.appliesAt!) };
  }

  it("lets another member veto, and a vetoed change never applies", async () => {
    const { id, appliesAt } = await scheduled();
    const before = await t
      .db()
      .select()
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.choreId, bathroom));
    const data = ok(
      await runAction(
        "veto_weight",
        { suggestionId: id },
        as(partner, { now: new Date(appliesAt.getTime() - HOUR) }),
      ),
    );
    expect(data).toMatchObject({ suggestionId: id, status: "vetoed" });
    expect(await suggestionRow(id)).toMatchObject({
      status: "vetoed",
      vetoedBy: partner,
    });
    expect(
      await tx((q) =>
        applyDueSuggestions(q, new Date(appliesAt.getTime() + 60 * DAY)),
      ),
    ).toEqual([]);
    expect(
      await t
        .db()
        .select()
        .from(choreRuleVersions)
        .where(eq(choreRuleVersions.choreId, bathroom)),
    ).toEqual(before);
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "veto_weight"));
    expect(audits.map((a) => [a.actorMemberId, a.entityId])).toEqual([
      [partner, id],
    ]);
    // A second veto finds it no longer scheduled.
    await expect(
      runAction("veto_weight", { suggestionId: id }, as(adminB)),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message: "That change was vetoed.",
    });
  });

  it("refuses the member who scheduled it", async () => {
    const { id } = await scheduled();
    await expect(
      runAction("veto_weight", { suggestionId: id }, asAdmin(adminA)),
    ).resolves.toMatchObject({ ok: false, code: "SELF_VETO" });
    expect((await suggestionRow(id)).status).toBe("scheduled");
  });

  it("closes at applies_at", async () => {
    const { id, appliesAt } = await scheduled();
    await expect(
      runAction(
        "veto_weight",
        { suggestionId: id },
        as(partner, { now: appliesAt }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "WINDOW_CLOSED",
      message: "The veto window closed at Mon 5 Oct, 00:00 (Berlin time).",
    });
  });

  it("refuses an unscheduled or unknown suggestion", async () => {
    const id = await e7Suggestion();
    await expect(
      runAction("veto_weight", { suggestionId: id }, as(partner)),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message: "That change is not scheduled.",
    });
    await expect(
      runAction(
        "veto_weight",
        { suggestionId: "00000000-0000-4000-8000-000000000000" },
        as(partner),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("applying a scheduled change", () => {
  it("inserts a suggestion rule version and changes no past score", async () => {
    const id = await e7Suggestion();
    const data = ok(
      await runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    );
    const before = await scores();
    expect(before.every((s) => s.basePts === 35)).toBe(true);
    const runAt = new Date(new Date(data.appliesAt!).getTime() + 2 * HOUR);
    const [applied] = await tx((q) => applyDueSuggestions(q, runAt));
    const [version] = await t
      .db()
      .select()
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.id, applied!.ruleVersionId));
    expect(version).toMatchObject({
      choreId: bathroom,
      source: "suggestion",
      suggestionId: id,
      basePoints: 26,
      effectiveFrom: runAt,
      createdBy: adminA,
    });
    expect(await scores()).toEqual(before);
    const after = ok(
      await runAction("get_weights", {}, as(partner, { now: runAt })),
    );
    expect(after.chores[0]).toMatchObject({
      current: { basePoints: 26, cooldownMinutes: 3.5 * DAY_MIN },
      suggestion: null,
      lastAppliedAt: data.appliesAt,
    });
    // The next log scores the new weight.
    ok(
      await runAction(
        "log_completion",
        { choreId: bathroom },
        as(partner, { now: new Date(runAt.getTime() + HOUR) }),
      ),
    );
    expect((await scores()).at(-1)?.basePts).toBe(26);
  });
});

describe("the weight writes' surfaces and gates", () => {
  it("schedule and dismiss are an admin's, veto any member's, all UI only", async () => {
    const id = await e7Suggestion();
    for (const name of ["schedule_weight", "dismiss_weight"]) {
      await expect(
        runAction(name, { suggestionId: id }, as(partner)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    for (const name of ["schedule_weight", "dismiss_weight", "veto_weight"]) {
      for (const [actor, source] of [
        [kiosk(adminB), "kiosk"],
        [sessionActor(adminB, "admin"), "ai"],
        [mcp(adminB), "mcp"],
        [brain(adminB), "brain"],
      ] as [Actor, RequestCtx["source"]][]) {
        await expect(
          runAction(name, { suggestionId: id }, ctxFor(actor, { source })),
        ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
      }
    }
    expect((await suggestionRow(id)).status).toBe("open");
  });
});
