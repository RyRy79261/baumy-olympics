import { seasonYear } from "@baumy/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { logCompletion, type LogCompletionInput } from "../completions";
import { applyCompletionEvent } from "../confirmations";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { pointAdjustments, seasons } from "../schema";
import {
  addPotContribution,
  approveAdjustment,
  countDisputes,
  createAdjustment,
  listPotContributions,
  listSeasonAdjustments,
  listSeasonScores,
  lockAdjustment,
  seasonHasCompletions,
  setPrizeMode,
} from "../scores";
import { ensureSeason } from "../seasons";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";
import { useTestDb } from "./_harness";

// The reads and writes behind the scoreboard, the streak board and the pot
// (issue #16), on PGlite.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-27T10:00:00Z");
const HOUR = 60 * 60_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

let reqSeq = 0;
function log(
  input: Pick<
    LogCompletionInput,
    "choreId" | "doneBy" | "loggedBy" | "occurredAt" | "now"
  >,
) {
  reqSeq += 1;
  return t.db().transaction(async (tx) => {
    const r = await logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      source: "ui",
      clientRequestId: `scores-${reqSeq}`,
      ...input,
    });
    if (!r.ok) throw new Error(`log failed: ${r.code}`);
    return r.completion;
  });
}

function selfClaim(choreId: string, member: string, when: Date) {
  return log({
    choreId,
    doneBy: member,
    loggedBy: member,
    occurredAt: when,
    now: when,
  });
}

async function season() {
  return ensureSeason(db(), {
    householdId: HOUSEHOLD_ID,
    year: seasonYear(NOW),
    now: NOW,
  });
}

describe("listSeasonScores", () => {
  it("lists the counted completions of the season with their scores, in replay order", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId: trash } = await seedChore(db(), SEED_CHORES.trash);
    const { choreId: dishes } = await seedChore(db(), SEED_CHORES.dishes);
    const first = await selfClaim(trash, ryan, NOW);
    // A voided claim is not counted, so it has no score.
    const undone = await selfClaim(dishes, ryan, at(1));
    await applyCompletionEvent(db(), {
      householdId: HOUSEHOLD_ID,
      completionId: undone.id,
      event: { type: "undo", actor: ryan },
      now: at(1),
    });
    const second = await log({
      choreId: trash,
      doneBy: partner,
      loggedBy: ryan,
      occurredAt: at(49),
      now: at(49),
    });

    const rows = await listSeasonScores(db(), second.seasonId);
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows[1]).toMatchObject({
      choreName: "Trash",
      doneBy: partner,
      loggedBy: ryan,
      status: "confirmed",
      verifiedBy: ryan,
      streakLen: 1,
      basePts: SEED_CHORES.trash.basePoints,
      brokenMemberId: ryan,
      brokenLen: 1,
      breakPts: 4,
      totalPts: 24,
    });
    expect(await seasonHasCompletions(db(), second.seasonId)).toBe(true);
  });

  it("is empty, and has no completions, for a new season", async () => {
    const s = await season();
    expect(await listSeasonScores(db(), s.id)).toEqual([]);
    expect(await seasonHasCompletions(db(), s.id)).toBe(false);
  });
});

describe("countDisputes", () => {
  it("counts disputes raised by and against each member inside the range", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId: trash } = await seedChore(db(), SEED_CHORES.trash);
    const c = await selfClaim(trash, ryan, NOW);
    const r = await t.db().transaction((tx) =>
      applyCompletionEvent(tx as unknown as Queryable, {
        householdId: HOUSEHOLD_ID,
        completionId: c.id,
        event: { type: "dispute", actor: partner, reason: "Not done" },
        now: at(1),
      }),
    );
    expect(r.ok).toBe(true);

    expect(
      await countDisputes(db(), {
        householdId: HOUSEHOLD_ID,
        since: NOW,
        until: at(2),
      }),
    ).toEqual(
      expect.arrayContaining([
        { memberId: partner, raised: 1, against: 0 },
        { memberId: ryan, raised: 0, against: 1 },
      ]),
    );
    // Outside the range, and in another household, nothing.
    expect(
      await countDisputes(db(), {
        householdId: HOUSEHOLD_ID,
        since: at(2),
        until: at(3),
      }),
    ).toEqual([]);
    expect(
      await countDisputes(db(), {
        householdId: "00000000-0000-4000-8000-000000000099",
        since: NOW,
        until: at(2),
      }),
    ).toEqual([]);
  });
});

describe("adjustments", () => {
  it("creates, lists, locks and approves an adjustment once", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const adminA = await seedPlayer(db(), "Admin A");
    const adminB = await seedPlayer(db(), "Admin B");
    const s = await season();
    const created = await createAdjustment(db(), {
      seasonId: s.id,
      memberId: ryan,
      points: -15,
      reason: "Left the bins out",
      createdBy: adminA,
      now: NOW,
    });
    expect(created).toMatchObject({ approvedBy: null, approvedAt: null });

    const locked = await t
      .db()
      .transaction((tx) =>
        lockAdjustment(tx as unknown as Queryable, HOUSEHOLD_ID, created.id),
      );
    expect(locked?.adjustment.id).toBe(created.id);
    expect(locked?.season.id).toBe(s.id);
    expect(
      await lockAdjustment(
        db(),
        "00000000-0000-4000-8000-000000000099",
        created.id,
      ),
    ).toBeNull();

    const approved = await approveAdjustment(db(), {
      adjustmentId: created.id,
      approvedBy: adminB,
      now: at(1),
    });
    expect(approved).toMatchObject({ approvedBy: adminB, approvedAt: at(1) });
    // A second approval finds nothing left to approve.
    expect(
      await approveAdjustment(db(), {
        adjustmentId: created.id,
        approvedBy: ryan,
        now: at(2),
      }),
    ).toBeNull();

    expect(await listSeasonAdjustments(db(), s.id)).toEqual([
      expect.objectContaining({
        id: created.id,
        points: -15,
        memberName: "Ryan",
        createdByName: "Admin A",
        approvedByName: "Admin B",
      }),
    ]);
  });

  it("is refused by the check constraint when the creator approves their own adjustment", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const admin = await seedPlayer(db(), "Admin");
    const s = await season();
    const created = await createAdjustment(db(), {
      seasonId: s.id,
      memberId: ryan,
      points: 10,
      reason: "Helped",
      createdBy: admin,
      now: NOW,
    });
    await expect(
      approveAdjustment(db(), {
        adjustmentId: created.id,
        approvedBy: admin,
        now: at(1),
      }),
    ).rejects.toThrow();
    const [row] = await t
      .db()
      .select()
      .from(pointAdjustments)
      .where(eq(pointAdjustments.id, created.id));
    expect(row!.approvedBy).toBeNull();
  });
});

describe("the pot", () => {
  it("adds contributions and lists them by month with the contributor's name", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const s = await season();
    const sept = await addPotContribution(db(), {
      seasonId: s.id,
      month: "2026-09-01",
      amountCents: 2500,
      contributedBy: ryan,
      note: null,
      now: NOW,
    });
    const aug = await addPotContribution(db(), {
      seasonId: s.id,
      month: "2026-08-01",
      amountCents: 2000,
      contributedBy: partner,
      note: "Late",
      now: at(1),
    });
    const rows = await listPotContributions(db(), s.id);
    expect(rows.map((r) => [r.id, r.contributedByName])).toEqual([
      [aug.id, "Partner"],
      [sept.id, "Ryan"],
    ]);
  });
});

describe("setPrizeMode", () => {
  it("sets the mode before the first completion and refuses after it when locking", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const { choreId: trash } = await seedChore(db(), SEED_CHORES.trash);
    const s = await season();
    const before = await setPrizeMode(db(), {
      seasonId: s.id,
      mode: "points",
      lockOnFirstCompletion: true,
    });
    expect(before).toMatchObject({ ok: true, season: { prizeMode: "points" } });

    await selfClaim(trash, ryan, NOW);
    await expect(
      setPrizeMode(db(), {
        seasonId: s.id,
        mode: "points",
        lockOnFirstCompletion: true,
      }),
    ).resolves.toEqual({ ok: false, code: "PRIZE_MODE_LOCKED" });
    // Without the lock (next year's season) it always goes through.
    await expect(
      setPrizeMode(db(), {
        seasonId: s.id,
        mode: "longest_streak",
        lockOnFirstCompletion: false,
      }),
    ).resolves.toMatchObject({
      ok: true,
      season: { prizeMode: "longest_streak" },
    });
  });

  it("throws for a season that does not exist", async () => {
    await expect(
      setPrizeMode(db(), {
        seasonId: "00000000-0000-4000-8000-0000000000aa",
        mode: "points",
        lockOnFirstCompletion: true,
      }),
    ).rejects.toThrow(/not found/);
    const rows = await t.db().select().from(seasons);
    expect(rows).toEqual([]);
  });
});
