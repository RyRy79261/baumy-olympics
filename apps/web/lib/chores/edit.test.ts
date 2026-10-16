// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { lockChoreRow } from "@baumy/db/chores";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { choreRuleVersions, chores } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { cooldownMinutesFromHours } from "@baumy/types";
import { FIXED_NOW, seedMember } from "@/test-utils/actions";
import {
  batchNamesFree,
  editBounty,
  type BatchEntry,
  type BountyPatch,
  type EditOptions,
  type EditScope,
} from "./edit";

// The bounty edit rules (issue #214) at the module's interface, on PGlite:
// half a weight in both modes, an archived bounty, a name another bounty
// has, and a bounty with no weight yet. The actions' own suites pin each
// action's wiring of these options.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const TRASH = SEED_CHORES.trash;
const DISHES = SEED_CHORES.dishes;
const TRASH_HOURS = TRASH.cooldownMinutes / 60;

let scope: EditScope;
let dishesId: string;
const ids: Record<"active" | "archived" | "bare", string> = {
  active: "",
  archived: "",
  bare: "",
};

beforeEach(async () => {
  const admin = await seedMember(db(), { role: "admin" });
  scope = { db: db(), householdId: HOUSEHOLD_ID, by: admin, now: FIXED_NOW };
  ({ choreId: ids.active } = await seedChore(db(), TRASH));
  ({ choreId: dishesId } = await seedChore(db(), DISHES));
  ({ choreId: ids.archived } = await seedChore(db(), {
    ...TRASH,
    name: "Old trash",
    archivedAt: FIXED_NOW,
  }));
  const [bare] = await t
    .db()
    .insert(chores)
    .values({ householdId: HOUSEHOLD_ID, name: "Bare", sprite: "bare" })
    .returning({ id: chores.id });
  ids.bare = bare!.id;
});

const together: EditOptions = {
  halves: "together",
  archived: "edit",
  names: "now",
};
const keepOther: EditOptions = {
  halves: "keepOther",
  archived: { refuse: (name) => `${name} is archived.` },
  names: "now",
};

type Expected =
  | {
      ok: true;
      name: string;
      /** The weight in effect afterwards; null while it has none. */
      weight: { basePoints: number; cooldownMinutes: number } | null;
      weightChanged: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      issues?: { path: string[]; message: string }[];
    };

const cases: {
  rule: string;
  chore: keyof typeof ids;
  patch: BountyPatch;
  options: EditOptions;
  expected: Expected;
}[] = [
  {
    rule: "together: both halves make a new weight",
    chore: "active",
    patch: { points: TRASH.basePoints + 1, cooldownHours: 2 },
    options: together,
    expected: {
      ok: true,
      name: TRASH.name,
      weight: {
        basePoints: TRASH.basePoints + 1,
        cooldownMinutes: cooldownMinutesFromHours(2),
      },
      weightChanged: true,
    },
  },
  {
    rule: "together: the points alone are refused, on the cooldown",
    chore: "active",
    patch: { name: "Bins", points: TRASH.basePoints + 1 },
    options: together,
    expected: {
      ok: false,
      code: "INVALID_INPUT",
      message: "Give the points and the cooldown together.",
      issues: [
        {
          path: ["cooldownHours"],
          message: "Give the points and the cooldown together.",
        },
      ],
    },
  },
  {
    rule: "together: the cooldown alone is refused, on the points",
    chore: "active",
    patch: { cooldownHours: 2 },
    options: together,
    expected: {
      ok: false,
      code: "INVALID_INPUT",
      message: "Give the points and the cooldown together.",
      issues: [
        {
          path: ["basePoints"],
          message: "Give the points and the cooldown together.",
        },
      ],
    },
  },
  {
    rule: "keepOther: the points alone keep the cooldown",
    chore: "active",
    patch: { points: TRASH.basePoints + 1 },
    options: keepOther,
    expected: {
      ok: true,
      name: TRASH.name,
      weight: {
        basePoints: TRASH.basePoints + 1,
        cooldownMinutes: TRASH.cooldownMinutes,
      },
      weightChanged: true,
    },
  },
  {
    rule: "keepOther: the cooldown alone keeps the points",
    chore: "active",
    patch: { cooldownHours: TRASH_HOURS + 1 },
    options: keepOther,
    expected: {
      ok: true,
      name: TRASH.name,
      weight: {
        basePoints: TRASH.basePoints,
        cooldownMinutes: cooldownMinutesFromHours(TRASH_HOURS + 1),
      },
      weightChanged: true,
    },
  },
  {
    rule: "the same weight again is no new weight",
    chore: "active",
    patch: { points: TRASH.basePoints, cooldownHours: TRASH_HOURS },
    options: together,
    expected: {
      ok: true,
      name: TRASH.name,
      weight: {
        basePoints: TRASH.basePoints,
        cooldownMinutes: TRASH.cooldownMinutes,
      },
      weightChanged: false,
    },
  },
  {
    rule: "archived, refuse: ARCHIVED_CHORE in the caller's words",
    chore: "archived",
    patch: { name: "New trash" },
    options: keepOther,
    expected: {
      ok: false,
      code: "ARCHIVED_CHORE",
      message: "Old trash is archived.",
    },
  },
  {
    rule: "archived, edit: the archived bounty is changed",
    chore: "archived",
    patch: { name: "New trash" },
    options: { ...keepOther, archived: "edit" },
    expected: {
      ok: true,
      name: "New trash",
      weight: {
        basePoints: TRASH.basePoints,
        cooldownMinutes: TRASH.cooldownMinutes,
      },
      weightChanged: false,
    },
  },
  {
    rule: "names now: another active bounty's name, in any case, is taken",
    chore: "active",
    patch: { name: DISHES.name.toUpperCase() },
    options: keepOther,
    expected: {
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message: `There is already a chore called ${DISHES.name.toUpperCase()}. Pick another name.`,
    },
  },
  {
    rule: "names now: an archived bounty's name is free",
    chore: "active",
    patch: { name: "Old trash" },
    options: together,
    expected: {
      ok: true,
      name: "Old trash",
      weight: {
        basePoints: TRASH.basePoints,
        cooldownMinutes: TRASH.cooldownMinutes,
      },
      weightChanged: false,
    },
  },
  {
    rule: "names afterBatch: the caller checks the name, not the edit",
    chore: "active",
    patch: { name: DISHES.name },
    options: { ...keepOther, names: "afterBatch" },
    expected: {
      ok: true,
      name: DISHES.name,
      weight: {
        basePoints: TRASH.basePoints,
        cooldownMinutes: TRASH.cooldownMinutes,
      },
      weightChanged: false,
    },
  },
  {
    rule: "no weight yet, keepOther: half a weight is NO_RULE_VERSION",
    chore: "bare",
    patch: {
      name: "Bare bins",
      proofMode: "required",
      points: TRASH.basePoints,
    },
    options: keepOther,
    expected: {
      ok: false,
      code: "NO_RULE_VERSION",
      message: "Bare has no points yet. Give both its points and its cooldown.",
    },
  },
  {
    rule: "no weight yet: both halves give it its first weight",
    chore: "bare",
    patch: { points: TRASH.basePoints, cooldownHours: 1 },
    options: keepOther,
    expected: {
      ok: true,
      name: "Bare",
      weight: {
        basePoints: TRASH.basePoints,
        cooldownMinutes: cooldownMinutesFromHours(1),
      },
      weightChanged: true,
    },
  },
  {
    rule: "no weight yet: settings alone need no weight",
    chore: "bare",
    patch: { proofMode: "required" },
    options: keepOther,
    expected: { ok: true, name: "Bare", weight: null, weightChanged: false },
  },
  // The order of the checks: archived, half a weight, the name, a missing
  // weight. Each row breaks every later rule too, so only the first speaks.
  {
    rule: "order: archived comes before half a weight and a taken name",
    chore: "archived",
    patch: { name: DISHES.name, points: TRASH.basePoints + 1 },
    options: { ...together, archived: keepOther.archived },
    expected: {
      ok: false,
      code: "ARCHIVED_CHORE",
      message: "Old trash is archived.",
    },
  },
  {
    rule: "order: half a weight comes before a taken name",
    chore: "active",
    patch: { name: DISHES.name, points: TRASH.basePoints + 1 },
    options: together,
    expected: {
      ok: false,
      code: "INVALID_INPUT",
      message: "Give the points and the cooldown together.",
      issues: [
        {
          path: ["cooldownHours"],
          message: "Give the points and the cooldown together.",
        },
      ],
    },
  },
  {
    rule: "order: a taken name comes before a missing weight",
    chore: "bare",
    patch: { name: DISHES.name, points: TRASH.basePoints },
    options: keepOther,
    expected: {
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message: `There is already a chore called ${DISHES.name}. Pick another name.`,
    },
  },
];

async function nameOf(id: string) {
  return (await settingsOf(id)).name;
}

/** The settings an edit may change, as stored. */
async function settingsOf(id: string) {
  const [r] = await t.db().select().from(chores).where(eq(chores.id, id));
  return { name: r!.name, kind: r!.kind, proofMode: r!.proofMode };
}

/** The newest rule version (by effective time), or null. */
async function weightOf(id: string) {
  const rows = await t
    .db()
    .select({
      basePoints: choreRuleVersions.basePoints,
      cooldownMinutes: choreRuleVersions.cooldownMinutes,
      effectiveFrom: choreRuleVersions.effectiveFrom,
    })
    .from(choreRuleVersions)
    .where(eq(choreRuleVersions.choreId, id));
  const last = rows.sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  )[rows.length - 1];
  return last
    ? { basePoints: last.basePoints, cooldownMinutes: last.cooldownMinutes }
    : null;
}

describe("editBounty", () => {
  it.each(cases)("$rule", async ({ chore, patch, options, expected }) => {
    const id = ids[chore];
    const before = { ...(await settingsOf(id)), weight: await weightOf(id) };
    const row = (await lockChoreRow(db(), HOUSEHOLD_ID, id))!;

    const r = await editBounty(scope, row, patch, options);

    if (expected.ok) {
      expect(r).toMatchObject({
        ok: true,
        chore: { id, name: expected.name },
        weightChanged: expected.weightChanged,
      });
      expect(await nameOf(id)).toBe(expected.name);
      expect(await weightOf(id)).toEqual(expected.weight);
    } else {
      expect(r).toEqual({
        ok: false,
        code: expected.code,
        message: expected.message,
        ...(expected.issues ? { issues: expected.issues } : {}),
      });
      // A refusal writes nothing.
      expect({ ...(await settingsOf(id)), weight: await weightOf(id) }).toEqual(
        before,
      );
    }
  });
});

describe("batchNamesFree", () => {
  /** Rename a bounty as a batch would have, and return its row. */
  async function renamed(id: string, name: string) {
    await t.db().update(chores).set({ name }).where(eq(chores.id, id));
    return (await lockChoreRow(db(), HOUSEHOLD_ID, id))!;
  }
  const row = async (id: string) =>
    (await lockChoreRow(db(), HOUSEHOLD_ID, id))!;

  it("lets two bounties swap names, judged on the end state", async () => {
    const entries: BatchEntry[] = [
      {
        chore: await renamed(ids.active, DISHES.name),
        renamed: true,
        restored: false,
      },
      {
        chore: await renamed(dishesId, TRASH.name),
        renamed: true,
        restored: false,
      },
    ];
    await expect(batchNamesFree(scope, entries)).resolves.toBeNull();
  });

  it("names the first clash, on the name or on the restore", async () => {
    const clash = await renamed(dishesId, TRASH.name);
    const trash = await row(ids.active);
    await expect(
      batchNamesFree(scope, [{ chore: trash, renamed: true, restored: false }]),
    ).resolves.toEqual({
      index: 0,
      on: "name",
      refusal: {
        ok: false,
        code: "CHORE_NAME_TAKEN",
        message: `There is already a chore called ${TRASH.name}. Pick another name.`,
      },
    });
    await expect(
      batchNamesFree(scope, [
        { chore: await row(ids.bare), renamed: true, restored: false },
        { chore: clash, renamed: false, restored: true },
      ]),
    ).resolves.toMatchObject({ index: 1, on: "restore" });
  });

  it("leaves alone a bounty the batch did not rename or restore, or archived", async () => {
    await renamed(dishesId, TRASH.name);
    const trash = await row(ids.active);
    // The clash is caught when the batch renamed it...
    await expect(
      batchNamesFree(scope, [{ chore: trash, renamed: true, restored: false }]),
    ).resolves.not.toBeNull();
    // ...and not when it did not, nor for a bounty that ends archived.
    await expect(
      batchNamesFree(scope, [
        { chore: trash, renamed: false, restored: false },
        { chore: await row(ids.archived), renamed: true, restored: false },
      ]),
    ).resolves.toBeNull();
  });
});
