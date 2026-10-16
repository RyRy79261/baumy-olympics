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
  editBounty,
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
const ids: Record<"active" | "archived" | "bare", string> = {
  active: "",
  archived: "",
  bare: "",
};

beforeEach(async () => {
  const admin = await seedMember(db(), { role: "admin" });
  scope = { db: db(), householdId: HOUSEHOLD_ID, by: admin, now: FIXED_NOW };
  ({ choreId: ids.active } = await seedChore(db(), TRASH));
  await seedChore(db(), DISHES);
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
      weight: { basePoints: TRASH.basePoints + 1, cooldownMinutes: 120 },
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
    patch: { points: 9 },
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
    patch: { points: 9, cooldownHours: 1 },
    options: keepOther,
    expected: {
      ok: true,
      name: "Bare",
      weight: { basePoints: 9, cooldownMinutes: 60 },
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
];

async function nameOf(id: string) {
  const [r] = await t.db().select().from(chores).where(eq(chores.id, id));
  return r!.name;
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
    const before = { name: await nameOf(id), weight: await weightOf(id) };
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
      expect({ name: await nameOf(id), weight: await weightOf(id) }).toEqual(
        before,
      );
    }
  });
});
