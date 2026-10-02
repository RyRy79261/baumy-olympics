import {
  RULESET_V1,
  scoreCompletion,
  seasonBounds,
  transition,
  type CompletionStatus,
  type DisputeResolution,
  type PrizeMode,
  type ProofMode,
  type SeasonStatus,
  type VoidReason,
} from "@baumy/core";
import { asc, eq } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  logCompletion,
  rebuildAllScores,
  rescoreChore,
  setCompletionStatus,
  type CompletionRow,
  type LogCompletionInput,
} from "../completions";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import type {
  disputeResolution,
  prizeMode,
  proofMode,
  seasonStatus,
  voidReason,
} from "../schema";
import {
  completionScores,
  completionStatus,
  completions,
  disputes,
  households,
  pointAdjustments,
  potContributions,
  seasons,
} from "../schema";
import { ensureSeason, findSeason } from "../seasons";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-27T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const TRASH = SEED_CHORES.trash;

let reqSeq = 0;

/** Run one logCompletion in its own transaction, as runAction would. */
function log(
  input: Omit<
    LogCompletionInput,
    "householdId" | "source" | "clientRequestId"
  > &
    Partial<Pick<LogCompletionInput, "source" | "clientRequestId">>,
) {
  reqSeq += 1;
  return t.db().transaction((tx) =>
    logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      source: "ui",
      clientRequestId: `req-${reqSeq}`,
      ...input,
    }),
  );
}

/** A self-claim at `at`, logged at `at`. */
function selfClaim(choreId: string, member: string, at: Date) {
  return log({
    choreId,
    doneBy: member,
    loggedBy: member,
    occurredAt: at,
    now: at,
  });
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

async function scoresInOrder(choreId: string) {
  return t
    .db()
    .select({
      completionId: completionScores.completionId,
      doneBy: completions.doneBy,
      streakLen: completionScores.streakLen,
      brokenLen: completionScores.brokenLen,
      totalPts: completionScores.totalPts,
    })
    .from(completionScores)
    .innerJoin(completions, eq(completions.id, completionScores.completionId))
    .where(eq(completions.choreId, choreId))
    .orderBy(asc(completions.occurredAt));
}

async function countCompletions(choreId: string) {
  const rows = await t
    .db()
    .select({ id: completions.id })
    .from(completions)
    .where(eq(completions.choreId, choreId));
  return rows.length;
}

const at = (hoursAfterNow: number) =>
  new Date(NOW.getTime() + hoursAfterNow * HOUR);

describe("schema enums mirror packages/core", () => {
  it("has the same values as the core unions", () => {
    expectTypeOf<
      (typeof completionStatus.enumValues)[number]
    >().toEqualTypeOf<CompletionStatus>();
    expectTypeOf<
      (typeof proofMode.enumValues)[number]
    >().toEqualTypeOf<ProofMode>();
    expectTypeOf<
      (typeof seasonStatus.enumValues)[number]
    >().toEqualTypeOf<SeasonStatus>();
    expectTypeOf<
      (typeof prizeMode.enumValues)[number]
    >().toEqualTypeOf<PrizeMode>();
    expectTypeOf<
      (typeof voidReason.enumValues)[number]
    >().toEqualTypeOf<VoidReason>();
    expectTypeOf<
      (typeof disputeResolution.enumValues)[number]
    >().toEqualTypeOf<DisputeResolution>();
    expect(completionStatus.enumValues).toContain("finalized");
  });
});

describe("ensureSeason", () => {
  it("creates the year's season lazily, active and in points mode", async () => {
    await expect(findSeason(db(), HOUSEHOLD_ID, 2026)).resolves.toBeNull();
    const s = await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: NOW,
    });
    expect(s).toMatchObject({
      year: 2026,
      status: "active",
      prizeMode: "points",
      winnerMemberId: null,
      ...seasonBounds(2026),
    });
  });

  it("returns the existing season on a second call", async () => {
    const a = await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: NOW,
    });
    const b = await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: NOW,
    });
    expect(b.id).toBe(a.id);
    const all = await t.db().select().from(seasons);
    expect(all).toHaveLength(1);
  });
});

describe("logCompletion", () => {
  it("stores a self-claim as optimistic pending and scores it", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const { choreId, ruleVersionId } = await seedChore(db(), TRASH);
    const r = ok(
      await log({
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: NOW,
        now: NOW,
        source: "kiosk",
        note: "bins out",
      }),
    );
    expect(r.duplicate).toBe(false);
    expect(r.completion).toMatchObject({
      choreId,
      doneBy: ryan,
      loggedBy: ryan,
      source: "kiosk",
      status: "pending",
      verifiedBy: null,
      finalizesAt: new Date(NOW.getTime() + RULESET_V1.challengeWindowH * HOUR),
      note: "bins out",
      photoAttachedAt: null,
    });
    expect(r.score).toMatchObject({
      completionId: r.completion.id,
      ruleVersionId,
      rulesetVersion: RULESET_V1.version,
      streakLen: 1,
      basePts: TRASH.basePoints,
      totalPts: TRASH.basePoints,
      brokenMemberId: null,
      computedAt: NOW,
    });
    const season = await findSeason(db(), HOUSEHOLD_ID, 2026);
    expect(r.completion.seasonId).toBe(season!.id);
  });

  it("verifies a completion logged for someone else on creation", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId } = await seedChore(db(), TRASH);
    const r = ok(
      await log({
        choreId,
        doneBy: partner,
        loggedBy: ryan,
        occurredAt: NOW,
        now: NOW,
      }),
    );
    expect(r.completion).toMatchObject({
      status: "confirmed",
      verifiedBy: ryan,
      verifiedAt: NOW,
      finalizesAt: null,
    });
    expect(r.score?.totalPts).toBe(TRASH.basePoints);
  });

  it("builds a streak and pays the break bonus (SPEC E1, E2)", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId } = await seedChore(db(), TRASH);
    const gap = TRASH.cooldownMinutes / 60;
    for (let i = 0; i < 4; i += 1) {
      ok(await selfClaim(choreId, ryan, at(i * gap)));
    }
    const broke = ok(await selfClaim(choreId, partner, at(4 * gap)));
    // E1: 20, 25, 30, 35. E2: breaking a 4-streak of Trash gives 36.
    expect((await scoresInOrder(choreId)).map((s) => s.totalPts)).toEqual([
      20, 25, 30, 35, 36,
    ]);
    expect(broke.score).toMatchObject({
      streakLen: 1,
      brokenMemberId: ryan,
      brokenLen: 4,
      totalPts: scoreCompletion(TRASH.basePoints, 1, 4).totalPts,
    });
  });

  it("rejects a second attempt within the cooldown and stores nothing (E5)", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId } = await seedChore(db(), TRASH);
    ok(await selfClaim(choreId, ryan, NOW));
    const retryAt = new Date(NOW.getTime() + TRASH.cooldownMinutes * MIN);
    await expect(selfClaim(choreId, ryan, at(12))).resolves.toEqual({
      ok: false,
      code: "COOLDOWN",
      retryAt,
    });
    await expect(selfClaim(choreId, partner, at(23))).resolves.toEqual({
      ok: false,
      code: "COOLDOWN",
      retryAt,
    });
    expect(await countCompletions(choreId)).toBe(1);
    // Exactly on the boundary is allowed.
    ok(await selfClaim(choreId, partner, retryAt));
    expect(await countCompletions(choreId)).toBe(2);
  });

  it("counts a disputed completion as live for the cooldown (E11)", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId } = await seedChore(db(), TRASH);
    const first = ok(await selfClaim(choreId, ryan, NOW));
    const disputed = transition(
      { ...first.completion, disputedBy: null },
      { type: "dispute", actor: partner, reason: "bins still full" },
      at(1),
    );
    if (!disputed.ok) throw new Error(disputed.code);
    ok(
      await setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: first.completion.id,
        expectedStatus: disputed.expectedStatus,
        next: disputed.row,
        now: at(1),
      }),
    );
    // A disputed row is not counted…
    await expect(scoresInOrder(choreId)).resolves.toEqual([]);
    // …but still blocks the cooldown.
    const r = await selfClaim(choreId, partner, at(2));
    expect(r).toMatchObject({ ok: false, code: "COOLDOWN" });
  });

  it("returns the existing completion for a duplicate client_request_id", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const input = {
      choreId,
      doneBy: ryan,
      loggedBy: ryan,
      occurredAt: NOW,
      now: NOW,
      clientRequestId: "proposal-123",
    };
    const first = ok(await log(input));
    // A retry a minute later, which the cooldown would otherwise refuse.
    const again = ok(
      await log({ ...input, now: new Date(NOW.getTime() + MIN) }),
    );
    expect(again.duplicate).toBe(true);
    expect(again.completion).toEqual(first.completion);
    expect(again.score).toEqual(first.score);
    expect(await countCompletions(choreId)).toBe(1);
  });

  it("refuses a client_request_id already used for another chore", async () => {
    const ryan = await seedPlayer(db());
    const trash = await seedChore(db(), TRASH);
    const dishes = await seedChore(db(), SEED_CHORES.dishes);
    ok(
      await log({
        choreId: trash.choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: NOW,
        now: NOW,
        clientRequestId: "shared-id",
      }),
    );
    await expect(
      log({
        choreId: dishes.choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: NOW,
        now: NOW,
        clientRequestId: "shared-id",
      }),
    ).resolves.toEqual({ ok: false, code: "REQUEST_ID_REUSED" });
    expect(await countCompletions(dishes.choreId)).toBe(0);
  });

  it("reaches back across the season boundary for the cooldown (E12)", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.dishes);
    const dec31 = new Date("2026-12-31T22:50:00Z"); // 23:50 Berlin
    const jan1 = new Date("2026-12-31T23:05:00Z"); // 00:05 Berlin, 2027
    ok(await selfClaim(choreId, ryan, dec31));
    await expect(selfClaim(choreId, ryan, jan1)).resolves.toMatchObject({
      ok: false,
      code: "COOLDOWN",
    });
    // Once the cooldown has passed, the January streak starts again at 1.
    const later = new Date(
      dec31.getTime() + SEED_CHORES.dishes.cooldownMinutes * MIN,
    );
    const r = ok(await selfClaim(choreId, ryan, later));
    expect(r.score?.streakLen).toBe(1);
    const s2027 = await findSeason(db(), HOUSEHOLD_ID, 2027);
    expect(r.completion.seasonId).toBe(s2027!.id);
  });

  it("ignores a previous-season row that is no longer live", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.dishes);
    const dec31 = new Date("2026-12-31T22:50:00Z");
    const first = ok(await selfClaim(choreId, ryan, dec31));
    ok(
      await setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: first.completion.id,
        expectedStatus: "pending",
        next: { ...first.completion, status: "disputed" },
        now: dec31,
      }),
    );
    // The dispute timed out without a photo at logged_at + 24h: not live.
    const jan2 = new Date(dec31.getTime() + 25 * HOUR);
    ok(await selfClaim(choreId, partner, jan2));
  });

  it("returns each validator error and writes nothing", async () => {
    const ryan = await seedPlayer(db());
    const archived = await seedChore(db(), {
      ...TRASH,
      archivedAt: at(-1),
    });
    await expect(selfClaim(archived.choreId, ryan, NOW)).resolves.toEqual({
      ok: false,
      code: "ARCHIVED_CHORE",
    });

    const trash = await seedChore(db(), TRASH);
    await expect(
      log({
        choreId: trash.choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: at(1),
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, code: "FUTURE" });
    await expect(
      log({
        choreId: trash.choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: at(-25),
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, code: "BACKDATE_TOO_FAR" });

    const proof = await seedChore(db(), { ...TRASH, proofMode: "required" });
    await expect(selfClaim(proof.choreId, ryan, NOW)).resolves.toEqual({
      ok: false,
      code: "PHOTO_REQUIRED",
    });

    ok(await selfClaim(trash.choreId, ryan, NOW));
    await expect(
      log({
        choreId: trash.choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: at(-1),
        now: at(1),
      }),
    ).resolves.toEqual({ ok: false, code: "OUT_OF_ORDER" });

    expect(await countCompletions(archived.choreId)).toBe(0);
    expect(await countCompletions(proof.choreId)).toBe(0);
    expect(await countCompletions(trash.choreId)).toBe(1);
  });

  it("refuses a closed season", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: NOW,
    });
    await t
      .db()
      .update(seasons)
      .set({ status: "closed" })
      .where(eq(seasons.year, 2026));
    await expect(selfClaim(choreId, ryan, NOW)).resolves.toEqual({
      ok: false,
      code: "SEASON_CLOSED",
    });
  });

  it("stores a proof photo with its attach time", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), {
      ...TRASH,
      proofMode: "required",
    });
    const r = ok(
      await log({
        choreId,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: NOW,
        now: NOW,
        photoPathname: "proof/abc.jpg",
      }),
    );
    expect(r.completion).toMatchObject({
      photoPathname: "proof/abc.jpg",
      photoAttachedAt: NOW,
    });
  });

  it("refuses an unknown chore, or one from another household", async () => {
    const ryan = await seedPlayer(db());
    await expect(
      selfClaim("00000000-0000-4000-8000-00000000dead", ryan, NOW),
    ).resolves.toEqual({ ok: false, code: "CHORE_NOT_FOUND" });

    const [other] = await t
      .db()
      .insert(households)
      .values({ name: "Other" })
      .returning({ id: households.id });
    const foreign = await seedChore(db(), {
      ...TRASH,
      householdId: other!.id,
    });
    await expect(selfClaim(foreign.choreId, ryan, NOW)).resolves.toEqual({
      ok: false,
      code: "CHORE_NOT_FOUND",
    });
  });

  it("refuses a completion before the chore's first rule version", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), {
      ...TRASH,
      effectiveFrom: at(1),
    });
    await expect(selfClaim(choreId, ryan, NOW)).resolves.toEqual({
      ok: false,
      code: "NO_RULE_VERSION",
    });
  });
});

describe("setCompletionStatus", () => {
  async function streakOfThree() {
    const ryan = await seedPlayer(db(), "Ryan");
    const { choreId } = await seedChore(db(), TRASH);
    const gap = TRASH.cooldownMinutes / 60;
    const rows: CompletionRow[] = [];
    for (let i = 0; i < 3; i += 1) {
      rows.push(ok(await selfClaim(choreId, ryan, at(i * gap))).completion);
    }
    return { ryan, choreId, rows };
  }

  it("voiding a middle completion re-scores the later rows", async () => {
    const { choreId, rows } = await streakOfThree();
    expect((await scoresInOrder(choreId)).map((s) => s.totalPts)).toEqual([
      20, 25, 30,
    ]);
    const middle = rows[1]!;
    const r = ok(
      await setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: middle.id,
        expectedStatus: "pending",
        next: { ...middle, status: "voided", voidReason: "undone" },
        now: at(200),
      }),
    );
    expect(r.completion).toMatchObject({
      status: "voided",
      voidReason: "undone",
    });
    const after = await scoresInOrder(choreId);
    expect(after.map((s) => s.completionId)).toEqual([
      rows[0]!.id,
      rows[2]!.id,
    ]);
    expect(after.map((s) => [s.streakLen, s.totalPts])).toEqual([
      [1, 20],
      [2, 25],
    ]);
  });

  it("upholding a disputed claim scores it again", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = ok(await selfClaim(choreId, ryan, NOW)).completion;
    ok(
      await setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: c.id,
        expectedStatus: "pending",
        next: { ...c, status: "disputed" },
        now: at(1),
      }),
    );
    await expect(scoresInOrder(choreId)).resolves.toEqual([]);
    ok(
      await setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: c.id,
        expectedStatus: "disputed",
        next: {
          ...c,
          status: "confirmed",
          verifiedBy: partner,
          verifiedAt: at(1),
        },
        now: at(1),
      }),
    );
    expect((await scoresInOrder(choreId)).map((s) => s.totalPts)).toEqual([
      TRASH.basePoints,
    ]);
  });

  it("is compare-and-set: a stale expected status changes nothing", async () => {
    const { choreId, rows } = await streakOfThree();
    const first = rows[0]!;
    await expect(
      setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: first.id,
        expectedStatus: "disputed",
        next: { ...first, status: "voided", voidReason: "conceded" },
        now: at(200),
      }),
    ).resolves.toEqual({ ok: false, code: "STALE" });
    const [row] = await t
      .db()
      .select()
      .from(completions)
      .where(eq(completions.id, first.id));
    expect(row!.status).toBe("pending");
    expect(await scoresInOrder(choreId)).toHaveLength(3);
  });

  it("reports a completion that does not exist", async () => {
    await expect(
      setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: "00000000-0000-4000-8000-00000000beef",
        expectedStatus: "pending",
        next: {
          status: "voided",
          voidReason: "undone",
          verifiedBy: null,
          verifiedAt: null,
          finalizesAt: null,
        },
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("completion_scores is always rebuildable", () => {
  it("drops and rebuilds identically", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const trash = await seedChore(db(), TRASH);
    const dishes = await seedChore(db(), SEED_CHORES.dishes);
    const bathroom = await seedChore(db(), SEED_CHORES.bathroom);
    const who = [ryan, ryan, partner, ryan, partner, partner];
    for (const [i, m] of who.entries()) {
      ok(await selfClaim(trash.choreId, m, at(i * 48)));
      ok(await selfClaim(dishes.choreId, m, at(i * 12)));
      ok(await selfClaim(bathroom.choreId, m, at(i * 84)));
    }
    // Some history crossing a season, and a voided row in the middle.
    const dec31 = new Date("2026-12-31T20:00:00Z");
    ok(await selfClaim(dishes.choreId, partner, dec31));
    ok(
      await selfClaim(
        dishes.choreId,
        ryan,
        new Date(dec31.getTime() + 12 * HOUR),
      ),
    );
    const mid = (
      await t
        .db()
        .select()
        .from(completions)
        .where(eq(completions.choreId, trash.choreId))
        .orderBy(asc(completions.occurredAt))
    )[2]!;
    ok(
      await setCompletionStatus(db(), {
        householdId: HOUSEHOLD_ID,
        completionId: mid.id,
        expectedStatus: "pending",
        next: { ...mid, status: "voided", voidReason: "conceded" },
        now: at(400),
      }),
    );

    const snapshot = async () =>
      (
        await t
          .db()
          .select()
          .from(completionScores)
          .orderBy(asc(completionScores.completionId))
      ).map(({ computedAt: _computedAt, ...rest }) => rest);
    const before = await snapshot();
    expect(before.length).toBeGreaterThan(10);

    await t.db().delete(completionScores);
    await expect(snapshot()).resolves.toEqual([]);

    const later = at(1000);
    const pairs = await t.db().transaction((tx) =>
      rebuildAllScores(tx as unknown as Queryable, {
        householdId: HOUSEHOLD_ID,
        now: later,
      }),
    );
    // trash, dishes 2026, dishes 2027, bathroom.
    expect(pairs).toBe(4);
    await expect(snapshot()).resolves.toEqual(before);
    const stamps = await t
      .db()
      .select({ at: completionScores.computedAt })
      .from(completionScores);
    expect(stamps.every((s) => s.at.getTime() === later.getTime())).toBe(true);
  });

  it("rescoreChore fixes a tampered score", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = ok(await selfClaim(choreId, ryan, NOW)).completion;
    await t
      .db()
      .update(completionScores)
      .set({ streakPts: 999, totalPts: 999 })
      .where(eq(completionScores.completionId, c.id));
    const scores = await rescoreChore(db(), {
      householdId: HOUSEHOLD_ID,
      choreId,
      seasonId: c.seasonId,
      now: at(1),
    });
    expect(scores.map((s) => s.totalPts)).toEqual([TRASH.basePoints]);
    expect((await scoresInOrder(choreId))[0]!.totalPts).toBe(TRASH.basePoints);
  });

  it("rescoreChore refuses an unknown chore", async () => {
    const s = await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: NOW,
    });
    await expect(
      rescoreChore(db(), {
        householdId: HOUSEHOLD_ID,
        choreId: "00000000-0000-4000-8000-00000000dead",
        seasonId: s.id,
        now: NOW,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("game table constraints", () => {
  async function arranged() {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = ok(await selfClaim(choreId, ryan, NOW)).completion;
    return { ryan, partner, c };
  }

  it("allows one open dispute per completion", async () => {
    const { partner, c } = await arranged();
    await t
      .db()
      .insert(disputes)
      .values({ completionId: c.id, raisedBy: partner, reason: "no" });
    await expect(
      t
        .db()
        .insert(disputes)
        .values({ completionId: c.id, raisedBy: partner, reason: "again" }),
    ).rejects.toThrow();
    // A resolved one does not count against it.
    await t
      .db()
      .update(disputes)
      .set({ resolution: "withdrawn", resolvedAt: NOW });
    await t
      .db()
      .insert(disputes)
      .values({ completionId: c.id, raisedBy: partner, reason: "again" });
    await expect(
      t
        .db()
        .insert(disputes)
        .values({ completionId: c.id, raisedBy: partner, reason: "  " }),
    ).rejects.toThrow();
  });

  it("will not let a member approve their own adjustment", async () => {
    const { ryan, partner, c } = await arranged();
    await t.db().insert(pointAdjustments).values({
      seasonId: c.seasonId,
      memberId: ryan,
      points: -5,
      reason: "fine",
      createdBy: ryan,
      approvedBy: partner,
      approvedAt: NOW,
    });
    await expect(
      t.db().insert(pointAdjustments).values({
        seasonId: c.seasonId,
        memberId: ryan,
        points: 5,
        reason: "self",
        createdBy: ryan,
        approvedBy: ryan,
        approvedAt: NOW,
      }),
    ).rejects.toThrow();
  });

  it("keeps pot contributions positive and on the first of a month", async () => {
    const { ryan, c } = await arranged();
    await t.db().insert(potContributions).values({
      seasonId: c.seasonId,
      month: "2026-09-01",
      amountCents: 500,
      contributedBy: ryan,
    });
    await expect(
      t.db().insert(potContributions).values({
        seasonId: c.seasonId,
        month: "2026-09-01",
        amountCents: 0,
        contributedBy: ryan,
      }),
    ).rejects.toThrow();
    await expect(
      t.db().insert(potContributions).values({
        seasonId: c.seasonId,
        month: "2026-09-15",
        amountCents: 500,
        contributedBy: ryan,
      }),
    ).rejects.toThrow();
  });

  it("requires a void reason exactly when voided", async () => {
    const { c } = await arranged();
    await expect(
      t
        .db()
        .update(completions)
        .set({ status: "voided" })
        .where(eq(completions.id, c.id)),
    ).rejects.toThrow();
  });
});
