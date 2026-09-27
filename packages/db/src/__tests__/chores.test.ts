import { expectedIntervalMinutes, seasonBounds, seasonYear } from "@baumy/core";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  STARTER_CHORES,
  choreNameTaken,
  createChore,
  listChoreBoard,
  lockChoreRow,
  seedStarterChores,
  setChoreArchived,
  starterChore,
  updateChore,
} from "../chores";
import {
  logCompletion,
  previewCompletion,
  type LogCompletionInput,
} from "../completions";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  choreRuleVersions,
  chores,
  completionScores,
  completions,
} from "../schema";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-27T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

let reqSeq = 0;
function log(
  input: Omit<LogCompletionInput, "householdId" | "source" | "clientRequestId">,
) {
  reqSeq += 1;
  return t.db().transaction((tx) =>
    logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      source: "ui",
      clientRequestId: `chores-req-${reqSeq}`,
      ...input,
    }),
  );
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

describe("STARTER_CHORES", () => {
  it("lists the eleven chores of SPEC §4.7", () => {
    expect(STARTER_CHORES.map((c) => c.name)).toEqual([
      "Trash",
      "Recycling",
      "Dishes",
      "Dishwasher (unload)",
      "Bathroom",
      "Vacuum",
      "Mop",
      "Laundry",
      "Plants",
      "Fridge clean-out",
      "Keller",
    ]);
  });

  it("follows the weight formula: the base gives back the interval, the cooldown is half of it clamped to 1h..7d", () => {
    for (const c of STARTER_CHORES) {
      const days = expectedIntervalMinutes(c.basePoints, 100) / (24 * 60);
      // Bases are rounded to whole points, so the interval comes back within
      // a few percent.
      expect(Math.abs(days - c.intervalDays) / c.intervalDays).toBeLessThan(
        0.05,
      );
      const half = (c.intervalDays * 24 * 60) / 2;
      expect(c.cooldownMinutes).toBe(Math.min(Math.max(half, 60), 7 * 24 * 60));
    }
  });

  it("starterChore finds one by name and refuses an unknown one", () => {
    expect(starterChore("Keller").basePoints).toBe(55);
    expect(() => starterChore("Garden")).toThrow("No starter chore");
  });
});

describe("seedStarterChores", () => {
  it("adds every starter chore with a seed rule version from the season start", async () => {
    const created = await t.db().transaction((tx) =>
      seedStarterChores(tx as unknown as Queryable, {
        householdId: HOUSEHOLD_ID,
        now: NOW,
      }),
    );
    expect(created).toBe(STARTER_CHORES.length);
    const rows = await t
      .db()
      .select({
        name: chores.name,
        sprite: chores.sprite,
        proofMode: chores.proofMode,
        confirmMode: chores.confirmMode,
        effortFactorPct: chores.effortFactorPct,
        basePoints: choreRuleVersions.basePoints,
        cooldownMinutes: choreRuleVersions.cooldownMinutes,
        source: choreRuleVersions.source,
        effectiveFrom: choreRuleVersions.effectiveFrom,
        createdBy: choreRuleVersions.createdBy,
      })
      .from(chores)
      .innerJoin(choreRuleVersions, eq(choreRuleVersions.choreId, chores.id))
      .orderBy(asc(chores.name));
    expect(rows).toHaveLength(STARTER_CHORES.length);
    for (const starter of STARTER_CHORES) {
      expect(rows.find((r) => r.name === starter.name)).toEqual({
        name: starter.name,
        sprite: starter.sprite,
        proofMode: "none",
        confirmMode: "optimistic",
        effortFactorPct: 100,
        basePoints: starter.basePoints,
        cooldownMinutes: starter.cooldownMinutes,
        source: "seed",
        effectiveFrom: seasonBounds(seasonYear(NOW)).startsAt,
        createdBy: null,
      });
    }
  });

  it("does nothing once the household has any chore, archived or renamed", async () => {
    const { choreId } = await seedChore(db(), {
      name: "Bins",
      basePoints: 20,
      cooldownMinutes: 60,
      archivedAt: NOW,
    });
    expect(choreId).toBeTruthy();
    await expect(
      seedStarterChores(db(), { householdId: HOUSEHOLD_ID, now: NOW }),
    ).resolves.toBe(0);
    const rows = await t.db().select({ id: chores.id }).from(chores);
    expect(rows).toHaveLength(1);
  });

  it("refuses a household that does not exist", async () => {
    await expect(
      seedStarterChores(db(), {
        householdId: "00000000-0000-4000-8000-00000000dead",
        now: NOW,
      }),
    ).rejects.toThrow("not found");
  });
});

describe("listChoreBoard", () => {
  it("is empty without chores", async () => {
    await expect(
      listChoreBoard(db(), { householdId: HOUSEHOLD_ID, now: NOW }),
    ).resolves.toEqual([]);
  });

  it("shows the weight now, this season's streak and when it was last done", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId: trash, ruleVersionId } = await seedChore(
      db(),
      SEED_CHORES.trash,
    );
    const { choreId: dishes } = await seedChore(db(), SEED_CHORES.dishes);
    await selfClaim(trash, ryan, at(0));
    await selfClaim(trash, ryan, at(48));
    await selfClaim(trash, partner, at(96));
    await selfClaim(trash, partner, at(144));

    const board = await listChoreBoard(db(), {
      householdId: HOUSEHOLD_ID,
      now: at(150),
    });
    // By name, case-insensitively.
    expect(board.map((c) => c.name)).toEqual(["Dishes", "Trash"]);
    expect(board[1]).toEqual({
      id: trash,
      name: "Trash",
      sprite: "trash",
      proofMode: "none",
      confirmMode: "optimistic",
      effortFactorPct: 100,
      archivedAt: null,
      rule: {
        id: ruleVersionId,
        basePoints: SEED_CHORES.trash.basePoints,
        cooldownMinutes: SEED_CHORES.trash.cooldownMinutes,
      },
      streak: { holderId: partner, holderName: "Partner", length: 2 },
      lastDoneAt: at(144),
    });
    expect(board[0]).toMatchObject({
      id: dishes,
      streak: null,
      lastDoneAt: null,
    });
  });

  it("starts the streak afresh in a new season but still knows the last time", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.dishes);
    const dec31 = new Date("2026-12-31T20:00:00Z");
    await selfClaim(choreId, ryan, dec31);
    const [row] = await listChoreBoard(db(), {
      householdId: HOUSEHOLD_ID,
      now: new Date("2027-01-01T12:00:00Z"),
    });
    expect(row).toMatchObject({ streak: null, lastDoneAt: dec31 });
  });

  it("skips a completion that is no longer live when saying when it was last done", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      confirmMode: "partner",
    });
    await selfClaim(choreId, ryan, at(0));
    // 72h later nobody confirmed it: it is voided (unconfirmed) at read time.
    const [live] = await listChoreBoard(db(), {
      householdId: HOUSEHOLD_ID,
      now: at(1),
    });
    expect(live?.lastDoneAt).toEqual(at(0));
    const [expired] = await listChoreBoard(db(), {
      householdId: HOUSEHOLD_ID,
      now: at(73),
    });
    expect(expired?.lastDoneAt).toBeNull();
    // Partner-mode pending is not counted, so nobody holds a streak.
    expect(expired?.streak).toBeNull();
  });

  it("leaves archived chores out unless asked, and a future-only weight as null", async () => {
    await seedChore(db(), { ...SEED_CHORES.trash, archivedAt: NOW });
    await seedChore(db(), {
      ...SEED_CHORES.dishes,
      effectiveFrom: at(24),
    });
    const active = await listChoreBoard(db(), {
      householdId: HOUSEHOLD_ID,
      now: NOW,
    });
    expect(active.map((c) => c.name)).toEqual(["Dishes"]);
    expect(active[0]?.rule).toBeNull();
    const all = await listChoreBoard(db(), {
      householdId: HOUSEHOLD_ID,
      now: NOW,
      includeArchived: true,
    });
    expect(all.map((c) => [c.name, c.archivedAt])).toEqual([
      ["Dishes", null],
      ["Trash", NOW],
    ]);
  });
});

describe("previewCompletion", () => {
  it("scores the next completion exactly as logCompletion then stores it", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    const plan: [string, number][] = [
      [ryan, 0],
      [ryan, 48],
      [ryan, 96],
      [partner, 144],
      [partner, 192],
      [ryan, 240],
    ];
    for (const [who, h] of plan) {
      const preview = await previewCompletion(db(), {
        householdId: HOUSEHOLD_ID,
        choreId,
        doneBy: who,
        loggedBy: who,
        occurredAt: at(h),
        now: at(h),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const logged = await selfClaim(choreId, who, at(h));
      expect(logged.ok).toBe(true);
      if (!logged.ok) return;
      expect(preview.counted).toBe(true);
      expect(preview.choreName).toBe("Trash");
      const { completionId: _id, ...stored } = logged.score!;
      const { completionId: _pid, ...previewed } = preview.score;
      expect({ ...previewed, computedAt: stored.computedAt }).toEqual(stored);
    }
    const totals = await t
      .db()
      .select({ total: completionScores.totalPts })
      .from(completionScores)
      .innerJoin(completions, eq(completions.id, completionScores.completionId))
      .orderBy(asc(completions.occurredAt));
    // 20, 25, 30, then the partner breaks a 3-streak (20 + 12), 25, and Ryan
    // breaks the partner's 2-streak (20 + 8).
    expect(totals.map((r) => r.total)).toEqual([20, 25, 30, 32, 25, 28]);
  });

  it("says a partner-mode self-claim is not counted yet, and one logged for someone else is", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.bathroom,
      confirmMode: "partner",
    });
    const self = await previewCompletion(db(), {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy: ryan,
      loggedBy: ryan,
      occurredAt: NOW,
      now: NOW,
    });
    expect(self).toMatchObject({
      ok: true,
      counted: false,
      score: { totalPts: SEED_CHORES.bathroom.basePoints, streakLen: 1 },
    });
    const vouched = await previewCompletion(db(), {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy: ryan,
      loggedBy: partner,
      occurredAt: NOW,
      now: NOW,
    });
    expect(vouched).toMatchObject({ ok: true, counted: true });
  });

  it("returns the validator's refusal, and the lookups' own", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    await selfClaim(choreId, ryan, NOW);
    const base = {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy: ryan,
      loggedBy: ryan,
    };
    await expect(
      previewCompletion(db(), { ...base, occurredAt: at(1), now: at(1) }),
    ).resolves.toEqual({ ok: false, code: "COOLDOWN", retryAt: at(48) });
    await expect(
      previewCompletion(db(), {
        ...base,
        choreId: "00000000-0000-4000-8000-00000000beef",
        occurredAt: NOW,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, code: "CHORE_NOT_FOUND" });
    const { choreId: later } = await seedChore(db(), {
      ...SEED_CHORES.dishes,
      effectiveFrom: at(24),
    });
    await expect(
      previewCompletion(db(), {
        ...base,
        choreId: later,
        occurredAt: NOW,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, code: "NO_RULE_VERSION" });
  });
});

describe("chore admin writes", () => {
  async function inTx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return t.db().transaction((tx) => fn(tx as unknown as Queryable));
  }

  it("creates a chore with a manual rule version in effect from now", async () => {
    const admin = await seedPlayer(db(), "Admin");
    const chore = await inTx((tx) =>
      createChore(tx, {
        householdId: HOUSEHOLD_ID,
        name: "Windows",
        sprite: "windows",
        proofMode: "optional",
        confirmMode: "partner",
        effortFactorPct: 150,
        basePoints: 40,
        cooldownMinutes: 3 * 24 * 60,
        createdBy: admin,
        now: NOW,
      }),
    );
    expect(chore).toMatchObject({
      name: "Windows",
      sprite: "windows",
      proofMode: "optional",
      confirmMode: "partner",
      effortFactorPct: 150,
      archivedAt: null,
    });
    const versions = await t
      .db()
      .select()
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.choreId, chore.id));
    expect(versions).toEqual([
      expect.objectContaining({
        effectiveFrom: NOW,
        basePoints: 40,
        cooldownMinutes: 3 * 24 * 60,
        source: "manual",
        createdBy: admin,
      }),
    ]);
  });

  it("adds a rule version only when the weight changes, and never rescores the past", async () => {
    const admin = await seedPlayer(db(), "Admin");
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    await selfClaim(choreId, ryan, NOW);

    const same = await inTx(async (tx) =>
      updateChore(tx, {
        householdId: HOUSEHOLD_ID,
        chore: (await lockChoreRow(tx, HOUSEHOLD_ID, choreId))!,
        settings: { name: "Bins" },
        weight: {
          basePoints: SEED_CHORES.trash.basePoints,
          cooldownMinutes: SEED_CHORES.trash.cooldownMinutes,
        },
        createdBy: admin,
        now: at(1),
      }),
    );
    expect(same.weightChanged).toBe(false);
    expect(same.chore.name).toBe("Bins");

    const heavier = await inTx(async (tx) =>
      updateChore(tx, {
        householdId: HOUSEHOLD_ID,
        chore: (await lockChoreRow(tx, HOUSEHOLD_ID, choreId))!,
        settings: {},
        weight: { basePoints: 30, cooldownMinutes: 60 },
        createdBy: admin,
        now: at(2),
      }),
    );
    expect(heavier).toMatchObject({
      weightChanged: true,
      chore: { name: "Bins" },
    });
    const versions = await t
      .db()
      .select({
        source: choreRuleVersions.source,
        basePoints: choreRuleVersions.basePoints,
        effectiveFrom: choreRuleVersions.effectiveFrom,
      })
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.choreId, choreId))
      .orderBy(asc(choreRuleVersions.effectiveFrom));
    expect(versions.map((v) => [v.source, v.basePoints])).toEqual([
      ["seed", 20],
      ["manual", 30],
    ]);
    // The completion logged before the change keeps its score.
    const [score] = await t.db().select().from(completionScores);
    expect(score?.totalPts).toBe(20);
    // The next one is scored and cooled down by the new weight.
    const next = await selfClaim(choreId, ryan, at(3));
    expect(next.ok && next.score?.basePts).toBe(30);

    // Two changes in the same instant: the later one wins.
    await inTx(async (tx) =>
      updateChore(tx, {
        householdId: HOUSEHOLD_ID,
        chore: (await lockChoreRow(tx, HOUSEHOLD_ID, choreId))!,
        settings: {},
        weight: { basePoints: 35, cooldownMinutes: 60 },
        createdBy: admin,
        now: at(2),
      }),
    );
    const after = await t
      .db()
      .select({ basePoints: choreRuleVersions.basePoints })
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.effectiveFrom, at(2)));
    expect(after).toEqual([{ basePoints: 35 }]);
  });

  it("gives a chore whose only weight is in the future one from now", async () => {
    const admin = await seedPlayer(db(), "Admin");
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.dishes,
      effectiveFrom: at(24),
    });
    const r = await inTx(async (tx) =>
      updateChore(tx, {
        householdId: HOUSEHOLD_ID,
        chore: (await lockChoreRow(tx, HOUSEHOLD_ID, choreId))!,
        settings: {},
        weight: { basePoints: 10, cooldownMinutes: 720 },
        createdBy: admin,
        now: NOW,
      }),
    );
    expect(r.weightChanged).toBe(true);
  });

  it("archives once (keeping the first time) and restores", async () => {
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    const archived = await inTx(async (tx) =>
      setChoreArchived(tx, {
        chore: (await lockChoreRow(tx, HOUSEHOLD_ID, choreId))!,
        archived: true,
        now: NOW,
      }),
    );
    expect(archived.archivedAt).toEqual(NOW);
    const again = await inTx(async (tx) =>
      setChoreArchived(tx, {
        chore: (await lockChoreRow(tx, HOUSEHOLD_ID, choreId))!,
        archived: true,
        now: at(1),
      }),
    );
    expect(again.archivedAt).toEqual(NOW);
    const restored = await inTx(async (tx) =>
      setChoreArchived(tx, {
        chore: (await lockChoreRow(tx, HOUSEHOLD_ID, choreId))!,
        archived: false,
        now: at(2),
      }),
    );
    expect(restored.archivedAt).toBeNull();
  });

  it("lockChoreRow finds only the household's chores", async () => {
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    await expect(
      inTx((tx) => lockChoreRow(tx, HOUSEHOLD_ID, choreId)),
    ).resolves.toMatchObject({ id: choreId });
    await expect(
      inTx((tx) =>
        lockChoreRow(tx, "00000000-0000-4000-8000-00000000dead", choreId),
      ),
    ).resolves.toBeNull();
  });

  it("choreNameTaken ignores case, archived chores and the chore itself", async () => {
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    await seedChore(db(), { ...SEED_CHORES.dishes, archivedAt: NOW });
    const taken = (name: string, exceptId?: string) =>
      choreNameTaken(db(), { householdId: HOUSEHOLD_ID, name, exceptId });
    await expect(taken("trash")).resolves.toBe(true);
    await expect(taken("TRASH", choreId)).resolves.toBe(false);
    await expect(taken("Dishes")).resolves.toBe(false);
    await expect(taken("Keller")).resolves.toBe(false);
  });
});
