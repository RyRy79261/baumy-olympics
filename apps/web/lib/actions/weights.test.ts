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

  it("is in the UI and brain only", async () => {
    await expect(
      runAction(
        "get_weights",
        { scheduledOnly: true },
        ctxFor(brain(partner), { source: "brain" }),
      ),
    ).resolves.toMatchObject({ ok: true, data: { chores: [], scheduled: [] } });
    for (const [actor, source] of [
      [kiosk(partner), "kiosk"],
      [sessionActor(partner), "ai"],
      [mcp(partner), "mcp"],
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
  it("schedule and dismiss are an admin's in the UI only; veto any member's, in the UI or brain", async () => {
    const id = await e7Suggestion();
    for (const name of ["schedule_weight", "dismiss_weight"]) {
      await expect(
        runAction(name, { suggestionId: id }, as(partner)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const surfaces: [Actor, RequestCtx["source"]][] = [
      [kiosk(adminB), "kiosk"],
      [sessionActor(adminB, "admin"), "ai"],
      [mcp(adminB), "mcp"],
      [brain(adminB), "brain"],
    ];
    for (const name of ["schedule_weight", "dismiss_weight"]) {
      for (const [actor, source] of surfaces) {
        await expect(
          runAction(name, { suggestionId: id }, ctxFor(actor, { source })),
        ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
      }
    }
    for (const [actor, source] of surfaces.slice(0, 3)) {
      await expect(
        runAction(
          "veto_weight",
          { suggestionId: id },
          ctxFor(actor, { source }),
        ),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    expect((await suggestionRow(id)).status).toBe("open");
    // Brain reaches the action: an open suggestion is not scheduled yet.
    await expect(
      runAction(
        "veto_weight",
        { suggestionId: id },
        ctxFor(brain(adminB), { source: "brain" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("brain vetoes a scheduled change for another member", async () => {
    const id = await e7Suggestion();
    const scheduled = ok(
      await runAction("schedule_weight", { suggestionId: id }, asAdmin(adminA)),
    );
    const data = ok(
      await runAction(
        "veto_weight",
        { suggestionId: id },
        ctxFor(brain(partner), {
          source: "brain",
          now: new Date(new Date(scheduled.appliesAt!).getTime() - HOUR),
        }),
      ),
    );
    expect(data).toMatchObject({ suggestionId: id, status: "vetoed" });
  });
});

describe("schedule_points_change (issue #115)", () => {
  const change = (over: Record<string, unknown> = {}) => ({
    choreId: bathroom,
    basePoints: 50,
    cooldownHours: 48,
    reason: "  It takes an hour  ",
    ...over,
  });

  it("schedules any points for the next Monday at least 48h ahead, with its reason and an audit row", async () => {
    const data = ok(
      await runAction("schedule_points_change", change(), asAdmin(adminA)),
    );
    const appliesAt = weightChangeAppliesAt({
      now: FIXED_NOW,
      lastAppliedAt: null,
    });
    expect(data).toMatchObject({
      choreId: bathroom,
      status: "scheduled",
      appliesAt: appliesAt.toISOString(),
      basePoints: 50,
      cooldownMinutes: 48 * 60,
    });
    expect(await suggestionRow(data.suggestionId)).toMatchObject({
      origin: "admin",
      currentPoints: 35,
      currentCooldownMinutes: BATHROOM.cooldownMinutes,
      scheduledPoints: 50,
      reason: "It takes an hour",
      scheduledBy: adminA,
      scheduledAt: FIXED_NOW,
    });
    const [audit] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "schedule_points_change"));
    expect(audit).toMatchObject({
      actorMemberId: adminA,
      entity: "weight_suggestion",
      entityId: data.suggestionId,
      payload: {
        choreId: bathroom,
        fromPoints: 35,
        toPoints: 50,
        reason: "It takes an hour",
      },
    });
    // Not in effect yet: the bounty is still worth 35, and the change waits
    // on another member's veto in get_weights.
    const weights = ok(
      await runAction("get_weights", { scheduledOnly: true }, as(partner)),
    );
    expect(weights.scheduled).toEqual([
      expect.objectContaining({
        id: data.suggestionId,
        origin: "admin",
        reason: "It takes an hour",
        canVeto: true,
        sampleIntervals: null,
      }),
    ]);
    const [version] = await t
      .db()
      .select()
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.choreId, bathroom));
    expect(version!.basePoints).toBe(35);
  });

  it("stores a blank reason as none", async () => {
    const data = ok(
      await runAction(
        "schedule_points_change",
        change({ reason: "   " }),
        asAdmin(adminA),
      ),
    );
    expect((await suggestionRow(data.suggestionId)).reason).toBeNull();
  });

  it("replaces the week's open suggestion, and skips the 28-day spacing", async () => {
    const open = await e7Suggestion();
    // A suggestion applied just now would hold the next one 28 days.
    const scheduled = ok(
      await runAction(
        "schedule_weight",
        { suggestionId: open },
        asAdmin(adminA),
      ),
    );
    const runAt = new Date(new Date(scheduled.appliesAt!).getTime() + HOUR);
    await tx((q) => applyDueSuggestions(q, runAt));
    const data = ok(
      await runAction(
        "schedule_points_change",
        change({ basePoints: 40 }),
        asAdmin(adminA, { now: runAt }),
      ),
    );
    expect(new Date(data.appliesAt!)).toEqual(
      weightChangeAppliesAt({ now: runAt, lastAppliedAt: null }),
    );
    expect(new Date(data.appliesAt!).getTime()).toBeLessThan(
      runAt.getTime() + 28 * DAY,
    );
    const landed = await tx((q) =>
      applyDueSuggestions(q, new Date(new Date(data.appliesAt!).getTime())),
    );
    expect(landed).toEqual([
      expect.objectContaining({
        suggestionId: data.suggestionId,
        basePoints: 40,
      }),
    ]);
  });

  it("supersedes an open suggestion it replaces", async () => {
    const open = await e7Suggestion();
    const data = ok(
      await runAction("schedule_points_change", change(), asAdmin(adminA)),
    );
    expect((await suggestionRow(open)).status).toBe("superseded");
    expect((await suggestionRow(data.suggestionId)).status).toBe("scheduled");
  });

  it("refuses a second change while one waits, and the same points", async () => {
    ok(await runAction("schedule_points_change", change(), asAdmin(adminA)));
    await expect(
      runAction(
        "schedule_points_change",
        change({ basePoints: 60 }),
        asAdmin(adminB),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CHANGE_PENDING",
      message: expect.stringContaining(
        "A change to Bathroom is already scheduled (35 → 50 pts",
      ),
    });
    await expect(
      runAction(
        "schedule_points_change",
        {
          choreId: bathroom,
          basePoints: 35,
          cooldownHours: BATHROOM.cooldownMinutes / 60,
        },
        asAdmin(adminB),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "NO_CHANGE",
      message: "Bathroom is already worth 35 pts with that cooldown.",
    });
  });

  it("refuses an unknown, archived or pointless bounty, and bad input inline", async () => {
    await expect(
      runAction(
        "schedule_points_change",
        change({ choreId: "00000000-0000-4000-8000-000000000000" }),
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    const { choreId: later } = await seedChore(db(), {
      ...SEED_CHORES.dishes,
      effectiveFrom: new Date(FIXED_NOW.getTime() + DAY),
    });
    await expect(
      runAction(
        "schedule_points_change",
        change({ choreId: later }),
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NO_RULE_VERSION" });
    await t
      .db()
      .update(chores)
      .set({ archivedAt: FIXED_NOW })
      .where(eq(chores.id, bathroom));
    await expect(
      runAction("schedule_points_change", change(), asAdmin(adminA)),
    ).resolves.toMatchObject({ ok: false, code: "ARCHIVED_CHORE" });
    const bad = await runAction(
      "schedule_points_change",
      change({ basePoints: 0, reason: "x".repeat(281) }),
      asAdmin(adminA),
    );
    expect(bad).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(!bad.ok && bad.issues?.map((i) => i.path[0]).sort()).toEqual([
      "basePoints",
      "reason",
    ]);
  });

  it("is an admin's, in the UI only", async () => {
    await expect(
      runAction("schedule_points_change", change(), as(partner)),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    for (const [actor, source] of [
      [kiosk(adminB), "kiosk"],
      [sessionActor(adminB, "admin"), "ai"],
      [mcp(adminB), "mcp"],
      [brain(adminB), "brain"],
    ] as [Actor, RequestCtx["source"]][]) {
      await expect(
        runAction(
          "schedule_points_change",
          change(),
          ctxFor(actor, { source }),
        ),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    expect(
      await t
        .db()
        .select()
        .from(weightSuggestions)
        .where(eq(weightSuggestions.choreId, bathroom)),
    ).toEqual([]);
  });

  it("is vetoed by another member, never by its admin, and a veto and a cancel race by compare-and-set", async () => {
    const first = ok(
      await runAction("schedule_points_change", change(), asAdmin(adminA)),
    );
    await expect(
      runAction(
        "veto_weight",
        { suggestionId: first.suggestionId },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SELF_VETO" });
    ok(
      await runAction(
        "veto_weight",
        { suggestionId: first.suggestionId },
        as(partner),
      ),
    );
    // The cancel that lost the race gets a sentence, and changes nothing.
    await expect(
      runAction(
        "dismiss_weight",
        { suggestionId: first.suggestionId },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message: "That change was vetoed.",
    });
    expect(await suggestionRow(first.suggestionId)).toMatchObject({
      status: "vetoed",
      vetoedBy: partner,
      dismissedBy: null,
    });

    // The other way round: cancelled first, then the veto loses.
    const second = ok(
      await runAction(
        "schedule_points_change",
        change({ basePoints: 45 }),
        asAdmin(adminA),
      ),
    );
    ok(
      await runAction(
        "dismiss_weight",
        { suggestionId: second.suggestionId },
        asAdmin(adminA),
      ),
    );
    await expect(
      runAction(
        "veto_weight",
        { suggestionId: second.suggestionId },
        as(partner),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message: "That suggestion was dismissed.",
    });
    // Neither ever applies.
    expect(
      await tx((q) =>
        applyDueSuggestions(q, new Date(FIXED_NOW.getTime() + 60 * DAY)),
      ),
    ).toEqual([]);
  });
});

describe("get_points_history (issue #115)", () => {
  it("shows every member who changed what, from what, to what, and who vetoed it", async () => {
    // The seed's createdAt is the database's clock; pin it before FIXED_NOW.
    await t
      .db()
      .update(choreRuleVersions)
      .set({ createdAt: new Date(FIXED_NOW.getTime() - DAY) })
      .where(eq(choreRuleVersions.choreId, bathroom));
    const vetoed = ok(
      await runAction(
        "schedule_points_change",
        {
          choreId: bathroom,
          basePoints: 50,
          cooldownHours: 48,
          reason: "It takes an hour",
        },
        asAdmin(adminA),
      ),
    );
    ok(
      await runAction(
        "veto_weight",
        { suggestionId: vetoed.suggestionId },
        as(partner, { now: new Date(FIXED_NOW.getTime() + HOUR) }),
      ),
    );
    const data = ok(
      await runAction("get_points_history", { choreId: bathroom }, as(partner)),
    );
    expect(data.changes).toEqual([
      expect.objectContaining({
        choreName: "Bathroom",
        source: "admin",
        proposedBy: { memberId: adminA, displayName: "Admin A" },
        proposedAt: FIXED_NOW.toISOString(),
        fromPoints: 35,
        toPoints: 50,
        toCooldownMinutes: 48 * 60,
        reason: "It takes an hour",
        outcome: "vetoed",
        decidedBy: { memberId: partner, displayName: "Partner" },
        decidedAt: new Date(FIXED_NOW.getTime() + HOUR).toISOString(),
      }),
      expect.objectContaining({
        source: "seed",
        outcome: "landed",
        fromPoints: null,
        toPoints: 35,
        decidedAt: null,
      }),
    ]);
    // Without a chore: every bounty's.
    await seedChore(db(), SEED_CHORES.dishes);
    const all = ok(await runAction("get_points_history", {}, as(partner)));
    expect(all.changes.map((c) => c.choreName).sort()).toEqual([
      "Bathroom",
      "Bathroom",
      "Dishes",
    ]);
  });

  it("is any member's, in the UI and brain only, and checks its input", async () => {
    await expect(
      runAction("get_points_history", { choreId: "nope" }, as(partner)),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const viaBrain = ok(
      await runAction(
        "get_points_history",
        {},
        ctxFor(brain(partner), { source: "brain" }),
      ),
    );
    expect(viaBrain.changes.map((c) => c.choreName)).toEqual(["Bathroom"]);
    for (const [actor, source] of [
      [kiosk(partner), "kiosk"],
      [sessionActor(partner), "ai"],
      [mcp(partner), "mcp"],
    ] as [Actor, RequestCtx["source"]][]) {
      await expect(
        runAction("get_points_history", {}, ctxFor(actor, { source })),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
  });
});
