// @vitest-environment node
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { RULESET_V1, seasonBounds, seasonYear } from "@baumy/core";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  auditEvents,
  completionScores,
  completions,
  members,
  pointAdjustments,
  potContributions,
  seasons,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  accountActor,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { RequestCtx } from "./define";
import { runAction } from "./registry";

// get_standings, get_streaks, get_pot, adjust_points, add_pot_contribution
// and set_prize_mode through the real runAction on PGlite (issue #16):
// success, every error code, the surfaces and the permissions.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (hours: number) => new Date(FIXED_NOW.getTime() + hours * HOUR);
const TRASH = SEED_CHORES.trash;
const DISHES = SEED_CHORES.dishes;
const YEAR = seasonYear(FIXED_NOW);

beforeEach(() => {
  __resetMemoryRateLimits();
});

function kiosk(memberId: string): Actor {
  return { kind: "kiosk", deviceId: "dev-1", memberId, displayName: "K" };
}
function mcp(memberId: string, scopes = ["baumy:read", "baumy:write"]): Actor {
  return { kind: "mcp", memberId, scopes };
}
function brain(memberId: string): Actor {
  return { kind: "service", tokenName: "baumy-brain", memberId };
}

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

let ryan: string;
let partner: string;
let adminA: string;
let adminB: string;
let trash: string;
let dishes: string;

const as = (member: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(member), over);
const asAdmin = (member: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(member, "admin"), over);

beforeEach(async () => {
  ryan = await seedMember(db(), { displayName: "Ryan" });
  partner = await seedMember(db(), { displayName: "Partner" });
  adminA = await seedMember(db(), { displayName: "Admin A", role: "admin" });
  adminB = await seedMember(db(), { displayName: "Admin B", role: "admin" });
  ({ choreId: trash } = await seedChore(db(), TRASH));
  ({ choreId: dishes } = await seedChore(db(), DISHES));
});

/** A self-claim logged at `when`, through the action. */
async function selfLog(member: string, choreId: string, when: Date) {
  return ok(
    await runAction("log_completion", { choreId }, as(member, { now: when })),
  );
}

/** A second admin approves what the first proposed. */
async function approvedAdjustment(
  memberId: string,
  points: number,
  when = FIXED_NOW,
) {
  const created = ok(
    await runAction(
      "adjust_points",
      { op: "create", memberId, points, reason: "Fixture" },
      asAdmin(adminA, { now: when }),
    ),
  );
  ok(
    await runAction(
      "adjust_points",
      { op: "approve", adjustmentId: created.adjustmentId },
      asAdmin(adminB, { now: when }),
    ),
  );
  return created.adjustmentId;
}

async function standings(over: Partial<RequestCtx> = {}, input = {}) {
  return ok(await runAction("get_standings", input, as(ryan, over)));
}

/** The season total straight from the tables, as SPEC §4.5 defines it. */
async function pointsFromTables(memberId: string): Promise<number> {
  const [scored] = await t
    .db()
    .select({
      n: sql<number>`coalesce(sum(${completionScores.totalPts}), 0)::int`,
    })
    .from(completionScores)
    .innerJoin(completions, eq(completions.id, completionScores.completionId))
    .where(eq(completions.doneBy, memberId));
  const [adjusted] = await t
    .db()
    .select({
      n: sql<number>`coalesce(sum(${pointAdjustments.points}), 0)::int`,
    })
    .from(pointAdjustments)
    .where(
      and(
        eq(pointAdjustments.memberId, memberId),
        isNotNull(pointAdjustments.approvedBy),
        ne(pointAdjustments.approvedBy, pointAdjustments.createdBy),
      ),
    );
  return scored!.n + adjusted!.n;
}

describe("get_standings", () => {
  it("ranks every active member at zero before anyone scores, with no leader and an open prize mode", async () => {
    const data = await standings();
    expect(data.season).toEqual({
      year: YEAR,
      prizeMode: "points",
      status: "active",
      prizeLocked: false,
      nextSeason: { year: YEAR + 1, prizeMode: "points", status: "active" },
    });
    expect(data.leaderId).toBeNull();
    expect(data.standings).toHaveLength(4);
    expect(data.standings.every((s) => s.points === 0 && s.rank === 1)).toBe(
      true,
    );
    expect(data.recent).toEqual([]);
    expect(data.adjustments).toEqual([]);
    expect(data.disputesThisMonth).toEqual({ month: "2026-09", members: [] });
    // Reading never creates the season.
    expect(await t.db().select().from(seasons)).toEqual([]);
  });

  it("equals the sum of completion_scores plus approved adjustments, per member", async () => {
    // Ryan: trash twice (a streak of 2), dishes once, then undoes nothing.
    await selfLog(ryan, trash, FIXED_NOW);
    await selfLog(ryan, dishes, at(1));
    await selfLog(ryan, trash, at(49));
    // The partner breaks Ryan's dishes streak, then logs trash for Ryan.
    await selfLog(partner, dishes, at(14));
    ok(
      await runAction(
        "log_completion",
        { choreId: trash, doneBy: ryan },
        as(partner, { now: at(98) }),
      ),
    );
    // A claim the partner undoes counts for nothing.
    const undone = await selfLog(partner, dishes, at(99));
    ok(
      await runAction(
        "undo_completion",
        { completionId: undone.completionId },
        as(partner, { now: at(99) }),
      ),
    );
    await approvedAdjustment(ryan, -7, at(100));
    await approvedAdjustment(partner, 12, at(100));
    // Proposed but not approved: it does not count yet.
    ok(
      await runAction(
        "adjust_points",
        { op: "create", memberId: partner, points: 500, reason: "Pending" },
        asAdmin(adminA, { now: at(100.5) }),
      ),
    );

    const data = await standings({ now: at(101) });
    const byId = new Map(data.standings.map((s) => [s.memberId, s]));
    for (const id of [ryan, partner, adminA, adminB]) {
      expect(byId.get(id)!.points).toBe(await pointsFromTables(id));
    }
    // Presence before absence: the numbers are real, not all zero.
    expect(byId.get(ryan)!.points).toBeGreaterThan(0);
    expect(byId.get(partner)!.adjustmentPts).toBe(12);
    expect(byId.get(ryan)!.adjustmentPts).toBe(-7);
    expect(byId.get(ryan)!.completions).toBe(4);
    // Logged by the partner, so verified.
    expect(byId.get(ryan)!.verifiedCount).toBe(1);

    const [first, second] = data.standings;
    expect(first!.memberId).toBe(ryan);
    expect(data.leaderId).toBe(ryan);
    expect(first!.gapToLeader).toBe(0);
    expect(second!.gapToLeader).toBe(first!.points - second!.points);
    expect(data.season.prizeLocked).toBe(true);
    expect(data.adjustments.map((a) => a.approvedByName)).toEqual([
      null,
      "Admin B",
      "Admin B",
    ]);
  });

  it("dims the points of claims that can still be disputed", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    ok(
      await runAction(
        "log_completion",
        { choreId: dishes, doneBy: ryan },
        as(partner, { now: at(0.5) }),
      ),
    );
    const fresh = await standings({ now: at(1) });
    const me = fresh.standings.find((s) => s.memberId === ryan)!;
    expect(me.points).toBe(TRASH.basePoints + DISHES.basePoints);
    expect(me.provisionalPts).toBe(TRASH.basePoints);
    expect(fresh.recent.map((r) => [r.choreName, r.provisional])).toEqual([
      ["Dishes", false],
      ["Trash", true],
    ]);
    // After the 24h window the self-claim is final: nothing is dimmed.
    const later = await standings({ now: at(25) });
    expect(
      later.standings.find((s) => s.memberId === ryan)!.provisionalPts,
    ).toBe(0);
  });

  it("breaks each recent completion down into base, streak and break points, newest first", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    await selfLog(ryan, trash, at(48));
    await selfLog(partner, trash, at(96));
    const data = await standings({ now: at(97) });
    expect(data.recent).toEqual([
      expect.objectContaining({
        choreName: "Trash",
        doneBy: partner,
        doneByName: "Partner",
        occurredAt: at(96).toISOString(),
        basePts: 20,
        streakLen: 1,
        streakBonusPts: 0,
        // Breaking a 2-streak: 40% of 20.
        breakPts: 8,
        brokenMemberName: "Ryan",
        brokenLen: 2,
        totalPts: 28,
      }),
      expect.objectContaining({
        doneBy: ryan,
        streakLen: 2,
        // 125% of 20.
        streakBonusPts: 5,
        breakPts: 0,
        brokenMemberName: null,
        totalPts: 25,
      }),
      expect.objectContaining({ streakLen: 1, totalPts: 20 }),
    ]);
    const limited = await standings({ now: at(97) }, { recent: 1 });
    expect(limited.recent.map((r) => r.doneBy)).toEqual([partner]);
    const none = await standings({ now: at(97) }, { recent: 0 });
    expect(none.recent).toEqual([]);
  });

  it("counts this month's disputes raised by and against each member", async () => {
    const claim = await selfLog(ryan, trash, FIXED_NOW);
    ok(
      await runAction(
        "dispute_completion",
        { completionId: claim.completionId, reason: "Bins still full" },
        as(partner, { now: at(1) }),
      ),
    );
    const data = await standings({ now: at(2) });
    expect(data.disputesThisMonth).toEqual({
      month: "2026-09",
      members: [
        { memberId: partner, displayName: "Partner", raised: 1, against: 0 },
        { memberId: ryan, displayName: "Ryan", raised: 0, against: 1 },
      ],
    });
    // Next month starts from zero (1 Oct is 4 days after FIXED_NOW).
    const october = await standings({ now: at(5 * 24) });
    expect(october.disputesThisMonth).toEqual({
      month: "2026-10",
      members: [],
    });
  });

  it("reproduces SPEC §4.6 E10: Ryan's 3020 beat the partner's 2850 and heavier, longer run", async () => {
    // Ryan's best run: 9 trash, every 3 days (9 × 20 = 180 base points).
    const ryanStart = new Date("2026-02-02T08:00:00Z");
    for (let i = 0; i < 9; i++) {
      await selfLog(ryan, trash, new Date(ryanStart.getTime() + i * 3 * DAY));
    }
    // The partner's best run: 21 dishes, daily (21 × 10 = 210).
    const partnerStart = new Date("2026-03-02T08:00:00Z");
    for (let i = 0; i < 21; i++) {
      await selfLog(
        partner,
        dishes,
        new Date(partnerStart.getTime() + i * DAY),
      );
    }
    // The rest of each season, as approved adjustments.
    const now = new Date("2026-06-01T10:00:00Z");
    const runPts = async (member: string) => pointsFromTables(member);
    await approvedAdjustment(ryan, 3020 - (await runPts(ryan)), now);
    await approvedAdjustment(partner, 2850 - (await runPts(partner)), now);

    const data = await standings({ now });
    expect(
      data.standings
        .slice(0, 2)
        .map((s) => [s.displayName, s.rank, s.points, s.gapToLeader]),
    ).toEqual([
      ["Ryan", 1, 3020, 0],
      ["Partner", 2, 2850, 170],
    ]);
    expect(data.leaderId).toBe(ryan);
    expect(data.season.prizeMode).toBe("points");

    const streaks = ok(await runAction("get_streaks", {}, as(ryan, { now })));
    expect(
      streaks.best
        .slice(0, 2)
        .map((r) => [r.memberName, r.choreName, r.length, r.basePts]),
    ).toEqual([
      ["Partner", "Dishes", 21, 210],
      ["Ryan", "Trash", 9, 180],
    ]);
    const pot = ok(await runAction("get_pot", {}, as(ryan, { now })));
    expect(pot.leader).toEqual({
      memberId: ryan,
      displayName: "Ryan",
      points: 3020,
    });
  });

  it("refuses a season whose prize mode v1 does not play", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    await t.db().update(seasons).set({ prizeMode: "heaviest_streak" });
    for (const name of ["get_standings", "get_pot"] as const) {
      await expect(runAction(name, {}, as(ryan))).resolves.toMatchObject({
        ok: false,
        code: "PRIZE_MODE_NOT_SUPPORTED",
      });
    }
  });

  it("reads another season by year", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    const last = await standings({}, { year: YEAR - 1 });
    expect(last.season.year).toBe(YEAR - 1);
    expect(last.standings.every((s) => s.points === 0)).toBe(true);
    expect(last.season.nextSeason).toMatchObject({ year: YEAR });
  });

  it("names a deactivated member who scored, and leaves them out once they have not", async () => {
    await selfLog(partner, trash, FIXED_NOW);
    await t
      .db()
      .update(members)
      .set({ deactivatedAt: FIXED_NOW })
      .where(eq(members.id, partner));
    const data = await standings({ now: at(1) });
    expect(data.standings[0]).toMatchObject({
      memberId: partner,
      displayName: "Partner",
    });
    expect(data.standings).toHaveLength(4);
  });
});

describe("the read actions' surfaces and gates", () => {
  const reads = ["get_standings", "get_streaks", "get_pot"] as const;

  it("are offered on every surface", async () => {
    const cases: [Actor, RequestCtx["source"]][] = [
      [sessionActor(ryan), "ui"],
      [kiosk(ryan), "kiosk"],
      [sessionActor(ryan), "ai"],
      [mcp(ryan, ["baumy:read"]), "mcp"],
      [brain(ryan), "brain"],
    ];
    for (const name of reads) {
      for (const [actor, source] of cases) {
        await expect(
          runAction(name, {}, ctxFor(actor, { source })),
        ).resolves.toMatchObject({ ok: true });
      }
    }
  });

  it("refuse anyone who is not a member, and unknown input", async () => {
    for (const name of reads) {
      await expect(
        runAction(name, {}, ctxFor(accountActor("stranger"))),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
      await expect(
        runAction(name, { everything: true }, as(ryan)),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });
});

describe("get_streaks", () => {
  it("lists who holds each chore's streak and the best runs of the season", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    await selfLog(ryan, trash, at(48));
    await selfLog(partner, trash, at(96));
    await selfLog(partner, dishes, at(97));
    const data = ok(
      await runAction("get_streaks", { best: 2 }, as(ryan, { now: at(98) })),
    );
    expect(data.year).toBe(YEAR);
    expect(
      data.current.map((r) => [r.choreName, r.memberName, r.length]),
    ).toEqual([
      // Equal lengths: the heavier chore first.
      ["Trash", "Partner", 1],
      ["Dishes", "Partner", 1],
    ]);
    expect(data.best).toEqual([
      {
        choreId: trash,
        choreName: "Trash",
        memberId: ryan,
        memberName: "Ryan",
        length: 2,
        basePts: 40,
        startedAt: FIXED_NOW.toISOString(),
        lastAt: at(48).toISOString(),
        current: false,
      },
      expect.objectContaining({ length: 1 }),
    ]);
  });

  it("is empty before anyone scores", async () => {
    expect(ok(await runAction("get_streaks", {}, as(ryan)))).toEqual({
      year: YEAR,
      current: [],
      best: [],
    });
  });
});

describe("get_pot", () => {
  it("adds up each month, keeps a running total and names the leader", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    // Recorded one minute apart, so each month lists them as they came in.
    const entries = [
      ["2026-08", "25", ryan],
      ["2026-09", "25", ryan],
      ["2026-08", "30.50", partner],
    ] as const;
    for (const [i, [month, amount, by]] of entries.entries()) {
      ok(
        await runAction(
          "add_pot_contribution",
          { month, amount, contributedBy: by },
          asAdmin(adminA, { now: new Date(FIXED_NOW.getTime() + i * MIN) }),
        ),
      );
    }
    const data = ok(await runAction("get_pot", {}, as(partner)));
    expect(data).toMatchObject({
      year: YEAR,
      prizeMode: "points",
      totalCents: 8050,
      leader: { memberId: ryan, displayName: "Ryan", points: 20 },
    });
    expect(
      data.months.map((m) => [
        m.month,
        m.totalCents,
        m.runningTotalCents,
        m.contributions.map((c) => c.contributedByName),
      ]),
    ).toEqual([
      ["2026-08", 5550, 5550, ["Ryan", "Partner"]],
      ["2026-09", 2500, 8050, ["Ryan"]],
    ]);
  });

  it("is empty with no leader before anything happens", async () => {
    expect(ok(await runAction("get_pot", {}, as(ryan)))).toEqual({
      year: YEAR,
      prizeMode: "points",
      totalCents: 0,
      months: [],
      leader: null,
    });
  });
});

describe("adjust_points", () => {
  it("proposes an adjustment that counts only once a second admin approves it, auditing both", async () => {
    const created = ok(
      await runAction(
        "adjust_points",
        {
          op: "create",
          memberId: ryan,
          points: "15",
          reason: "Fixed the sink",
        },
        asAdmin(adminA),
      ),
    );
    expect(created).toMatchObject({
      memberId: ryan,
      points: 15,
      approved: false,
    });
    const before = await standings();
    expect(before.standings.find((s) => s.memberId === ryan)!.points).toBe(0);

    const approved = ok(
      await runAction(
        "adjust_points",
        { op: "approve", adjustmentId: created.adjustmentId },
        asAdmin(adminB, { now: at(1) }),
      ),
    );
    expect(approved.approved).toBe(true);
    const after = await standings({ now: at(1) });
    expect(after.standings[0]).toMatchObject({ memberId: ryan, points: 15 });
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "adjust_points"));
    expect(audits.map((a) => [a.actorMemberId, a.entity, a.entityId])).toEqual([
      [adminA, "point_adjustment", created.adjustmentId],
      [adminB, "point_adjustment", created.adjustmentId],
    ]);
  });

  it("rejects an approval by the admin who created it", async () => {
    const created = ok(
      await runAction(
        "adjust_points",
        { op: "create", memberId: ryan, points: 10, reason: "Helped" },
        asAdmin(adminA),
      ),
    );
    await expect(
      runAction(
        "adjust_points",
        { op: "approve", adjustmentId: created.adjustmentId },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    const [row] = await t
      .db()
      .select()
      .from(pointAdjustments)
      .where(eq(pointAdjustments.id, created.adjustmentId));
    expect(row!.approvedBy).toBeNull();
    const data = await standings();
    expect(data.standings.find((s) => s.memberId === ryan)!.points).toBe(0);
  });

  it("refuses a second approval, an unknown adjustment or member, and a closed season", async () => {
    const id = await approvedAdjustment(ryan, 5);
    await expect(
      runAction(
        "adjust_points",
        { op: "approve", adjustmentId: id },
        asAdmin(adminB),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
    await expect(
      runAction(
        "adjust_points",
        { op: "approve", adjustmentId: crypto.randomUUID() },
        asAdmin(adminB),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(
      runAction(
        "adjust_points",
        { op: "create", memberId: crypto.randomUUID(), points: 5, reason: "x" },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });

    const pending = ok(
      await runAction(
        "adjust_points",
        { op: "create", memberId: ryan, points: 5, reason: "Late" },
        asAdmin(adminA),
      ),
    );
    await t.db().update(seasons).set({ status: "closed" });
    await expect(
      runAction(
        "adjust_points",
        { op: "approve", adjustmentId: pending.adjustmentId },
        asAdmin(adminB),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SEASON_CLOSED" });
  });

  it("judges a closed season at now, whether or not the daily job has run", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    const pending = ok(
      await runAction(
        "adjust_points",
        { op: "create", memberId: ryan, points: 5, reason: "Late" },
        asAdmin(adminA),
      ),
    );
    const { endsAt } = seasonBounds(YEAR);
    const closing = new Date(endsAt.getTime() + HOUR);
    const closed = new Date(endsAt.getTime() + RULESET_V1.maxBackdateH * HOUR);
    // Stored as active throughout: nothing has run the job.
    const read = async (now: Date) =>
      (await standings({ now }, { year: YEAR })).season.status;
    expect(await read(FIXED_NOW)).toBe("active");
    expect(await read(closing)).toBe("closing");
    expect(await read(closed)).toBe("closed");
    await expect(
      runAction(
        "adjust_points",
        { op: "approve", adjustmentId: pending.adjustmentId },
        asAdmin(adminB, { now: closed }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SEASON_CLOSED" });
    const [season] = await t.db().select().from(seasons);
    expect(season!.status).toBe("active");
    // While it is only closing, an approval still counts.
    ok(
      await runAction(
        "adjust_points",
        { op: "approve", adjustmentId: pending.adjustmentId },
        asAdmin(adminB, { now: closing }),
      ),
    );
  });

  it("validates the points and the reason", async () => {
    for (const bad of [
      { op: "create", memberId: ryan, points: 0, reason: "x" },
      { op: "create", memberId: ryan, points: "1.5", reason: "x" },
      { op: "create", memberId: ryan, points: 5, reason: "  " },
      { op: "delete", adjustmentId: crypto.randomUUID() },
    ]) {
      await expect(
        runAction("adjust_points", bad, asAdmin(adminA)),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });
});

describe("add_pot_contribution", () => {
  it("records money for this season, paid by the admin unless someone else is named", async () => {
    const data = ok(
      await runAction(
        "add_pot_contribution",
        { month: "2026-09", amount: "40", note: "September" },
        asAdmin(adminA),
      ),
    );
    expect(data).toMatchObject({
      month: "2026-09",
      amountCents: 4000,
      contributedBy: adminA,
    });
    const [row] = await t.db().select().from(potContributions);
    expect(row).toMatchObject({
      month: "2026-09-01",
      amountCents: 4000,
      note: "September",
    });
    const [audit] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "add_pot_contribution"));
    expect(audit).toMatchObject({
      entity: "pot_contribution",
      entityId: data.contributionId,
    });
  });

  it("takes last December in January, while last season is still open", async () => {
    const january = new Date("2027-01-05T10:00:00Z");
    ok(
      await runAction(
        "add_pot_contribution",
        { month: "2026-12", amount: 25, contributedBy: partner },
        asAdmin(adminA, { now: january }),
      ),
    );
    const pot = ok(
      await runAction("get_pot", { year: 2026 }, as(ryan, { now: january })),
    );
    expect(pot.totalCents).toBe(2500);
  });

  it("refuses a month that has not started, a closed or long-gone season, and an unknown payer", async () => {
    await expect(
      runAction(
        "add_pot_contribution",
        { month: "2026-10", amount: 25 },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FUTURE" });
    await expect(
      runAction(
        "add_pot_contribution",
        { month: "2024-12", amount: 25 },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SEASON_CLOSED" });
    await t
      .db()
      .insert(seasons)
      .values({
        householdId: HOUSEHOLD_ID,
        year: YEAR - 1,
        startsAt: new Date("2024-12-31T23:00:00Z"),
        endsAt: new Date("2025-12-31T23:00:00Z"),
        status: "closed",
      });
    await expect(
      runAction(
        "add_pot_contribution",
        { month: "2025-12", amount: 25 },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SEASON_CLOSED" });
    await expect(
      runAction(
        "add_pot_contribution",
        { month: "2026-09", amount: 25, contributedBy: crypto.randomUUID() },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await t.db().select().from(potContributions)).toEqual([]);
  });

  it("validates the month and the amount", async () => {
    for (const bad of [
      { month: "2026-9", amount: 25 },
      { month: "2026-09", amount: "0" },
      { month: "2026-09", amount: "12.345" },
    ]) {
      await expect(
        runAction("add_pot_contribution", bad, asAdmin(adminA)),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });
});

describe("set_prize_mode", () => {
  it("sets this season's mode before its first completion and returns PRIZE_MODE_LOCKED after it", async () => {
    await expect(
      runAction(
        "set_prize_mode",
        { season: "current", mode: "points" },
        asAdmin(adminA),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { year: YEAR, prizeMode: "points" },
    });
    await selfLog(ryan, trash, FIXED_NOW);
    await expect(
      runAction(
        "set_prize_mode",
        { season: "current", mode: "points" },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "PRIZE_MODE_LOCKED" });
    const data = await standings();
    expect(data.season.prizeLocked).toBe(true);
  });

  it("always sets next year's mode, creating that season", async () => {
    await selfLog(ryan, trash, FIXED_NOW);
    await expect(
      runAction(
        "set_prize_mode",
        { season: "next", mode: "points" },
        asAdmin(adminA),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { year: YEAR + 1, prizeMode: "points" },
    });
    const [next] = await t
      .db()
      .select()
      .from(seasons)
      .where(eq(seasons.year, YEAR + 1));
    expect(next).toMatchObject({ prizeMode: "points", status: "active" });
    const [audit] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "set_prize_mode"));
    expect(audit).toMatchObject({ entity: "season", entityId: next!.id });
  });

  it("refuses the reserved modes", async () => {
    for (const mode of ["heaviest_streak", "longest_streak"]) {
      await expect(
        runAction("set_prize_mode", { season: "next", mode }, asAdmin(adminA)),
      ).resolves.toMatchObject({ ok: false, code: "PRIZE_MODE_NOT_SUPPORTED" });
    }
    await expect(
      runAction(
        "set_prize_mode",
        { season: "later", mode: "points" },
        asAdmin(adminA),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await t.db().select().from(seasons)).toEqual([]);
  });
});

describe("the admin writes' surfaces and gates", () => {
  const writes: [string, Record<string, unknown>][] = [
    ["set_prize_mode", { season: "next", mode: "points" }],
    ["adjust_points", { op: "create", memberId: "", points: 5, reason: "x" }],
  ];

  it("are for an admin's own session, and only in the UI", async () => {
    for (const [name, rawInput] of writes) {
      const input =
        name === "adjust_points" ? { ...rawInput, memberId: ryan } : rawInput;
      await expect(runAction(name, input, as(ryan))).resolves.toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      for (const [actor, source] of [
        [kiosk(adminA), "kiosk"],
        [sessionActor(adminA, "admin"), "ai"],
        [mcp(adminA), "mcp"],
        [brain(adminA), "brain"],
      ] as [Actor, RequestCtx["source"]][]) {
        await expect(
          runAction(name, input, ctxFor(actor, { source })),
        ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
      }
    }
    expect(await t.db().select().from(seasons)).toEqual([]);
    expect(await t.db().select().from(potContributions)).toEqual([]);
    expect(await t.db().select().from(pointAdjustments)).toEqual([]);
  });
});
