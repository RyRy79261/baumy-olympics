import {
  isLive,
  ruleVersionAt,
  seasonBounds,
  seasonYear,
  type ConfirmMode,
  type ProofMode,
  type RuleVersion,
} from "@baumy/core";
import type { ChoreKind } from "@baumy/types";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { rescoreChore } from "./completions";
import {
  choreRuleVersions,
  chores,
  completionScores,
  completions,
  households,
  members,
} from "./schema";
import { findSeason } from "./seasons";

// Chores and their weights (SPEC §4.7, §5): the starter set, the reads behind
// the chore grid (`list_chores`) and the admin writes behind `manage_chore`.
// Every function takes the caller's handle; the writes run in runAction's
// transaction and write neither `audit_events` nor `action_requests`.
//
// A chore's weight (base points and cooldown) is never edited in place: a
// change inserts a `chore_rule_versions` row effective from `now`, so
// completions already scored keep the weight they were scored with.

export type ChoreRow = typeof chores.$inferSelect;

const HOUR_MIN = 60;
const DAY_MIN = 24 * HOUR_MIN;

export interface StarterChore {
  name: string;
  sprite: string;
  /**
   * All eleven are chores to clean or fix, so all are `maintenance`, the
   * column's default; nothing in the list is bought or refilled.
   */
  kind: ChoreKind;
  /** The expected interval SPEC §4.7 derived `basePoints` from; docs only. */
  intervalDays: number;
  basePoints: number;
  cooldownMinutes: number;
}

/**
 * SPEC §4.7, in its order. `base ≈ 10·sqrt(I_days)` and
 * `cooldown = clamp(0.5·I, 1h, 7d)`, all at effort 100%.
 */
export const STARTER_CHORES: readonly StarterChore[] = [
  {
    name: "Trash",
    sprite: "trash",
    kind: "maintenance",
    intervalDays: 4,
    basePoints: 20,
    cooldownMinutes: 48 * HOUR_MIN,
  },
  {
    name: "Recycling",
    sprite: "recycling",
    kind: "maintenance",
    intervalDays: 7,
    basePoints: 26,
    cooldownMinutes: 84 * HOUR_MIN,
  },
  {
    name: "Dishes",
    sprite: "dishes",
    kind: "maintenance",
    intervalDays: 1,
    basePoints: 10,
    cooldownMinutes: 12 * HOUR_MIN,
  },
  {
    name: "Dishwasher (unload)",
    sprite: "dishwasher",
    kind: "maintenance",
    intervalDays: 2,
    basePoints: 14,
    cooldownMinutes: 24 * HOUR_MIN,
  },
  {
    name: "Bathroom",
    sprite: "bathroom",
    kind: "maintenance",
    intervalDays: 7,
    basePoints: 26,
    cooldownMinutes: 84 * HOUR_MIN,
  },
  {
    name: "Vacuum",
    sprite: "vacuum",
    kind: "maintenance",
    intervalDays: 7,
    basePoints: 26,
    cooldownMinutes: 84 * HOUR_MIN,
  },
  {
    name: "Mop",
    sprite: "mop",
    kind: "maintenance",
    intervalDays: 14,
    basePoints: 37,
    cooldownMinutes: 7 * DAY_MIN,
  },
  {
    name: "Laundry",
    sprite: "laundry",
    kind: "maintenance",
    intervalDays: 3,
    basePoints: 17,
    cooldownMinutes: 36 * HOUR_MIN,
  },
  {
    name: "Plants",
    sprite: "plants",
    kind: "maintenance",
    intervalDays: 4,
    basePoints: 20,
    cooldownMinutes: 48 * HOUR_MIN,
  },
  {
    name: "Fridge clean-out",
    sprite: "fridge",
    kind: "maintenance",
    intervalDays: 30,
    basePoints: 55,
    cooldownMinutes: 7 * DAY_MIN,
  },
  {
    name: "Keller",
    sprite: "keller",
    kind: "maintenance",
    intervalDays: 30,
    basePoints: 55,
    cooldownMinutes: 7 * DAY_MIN,
  },
];

/** One of the starter chores by name, for tests and fixtures. */
export function starterChore(name: string): StarterChore {
  const found = STARTER_CHORES.find((c) => c.name === name);
  if (!found) throw new Error(`No starter chore named ${name}.`);
  return found;
}

/**
 * Give a household the starter chores, each with a `seed` rule version in
 * effect from the start of the current season, but only if it has no chores
 * at all yet. Renaming or archiving a starter chore never brings it back.
 * The household row is locked first, so two seeds at once add one set.
 * Returns how many chores it created.
 */
export async function seedStarterChores(
  db: Queryable,
  input: { householdId: string; now: Date },
): Promise<number> {
  const [household] = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, input.householdId))
    .for("update");
  if (!household) throw new Error(`Household ${input.householdId} not found.`);
  const [existing] = await db
    .select({ id: chores.id })
    .from(chores)
    .where(eq(chores.householdId, input.householdId))
    .limit(1);
  if (existing) return 0;

  const effectiveFrom = seasonBounds(seasonYear(input.now)).startsAt;
  for (const starter of STARTER_CHORES) {
    const [chore] = await db
      .insert(chores)
      .values({
        householdId: input.householdId,
        name: starter.name,
        sprite: starter.sprite,
        kind: starter.kind,
        createdAt: input.now,
      })
      .returning({ id: chores.id });
    await db.insert(choreRuleVersions).values({
      choreId: chore!.id,
      effectiveFrom,
      basePoints: starter.basePoints,
      cooldownMinutes: starter.cooldownMinutes,
      source: "seed",
      createdAt: input.now,
    });
  }
  return STARTER_CHORES.length;
}

/** A chore as the grid and the admin page see it. */
export interface ChoreBoardRow {
  id: string;
  name: string;
  sprite: string;
  kind: ChoreKind;
  proofMode: ProofMode;
  confirmMode: ConfirmMode;
  effortFactorPct: number;
  archivedAt: Date | null;
  createdAt: Date;
  /** The rule version in effect at `now`; null if none is yet. */
  rule: { id: string; basePoints: number; cooldownMinutes: number } | null;
  /** Who holds the chore's streak this season, from the stored scores. */
  streak: { holderId: string; holderName: string; length: number } | null;
  /** The last live completion's `occurred_at`, across seasons. */
  lastDoneAt: Date | null;
}

/**
 * How many rows not stored as voided are looked at to find a chore's last
 * *live* completion (the same bound as completions.ts): only a timed-out
 * dispute or an expired partner-mode claim is not live without being voided.
 */
const LAST_LIVE_SCAN = 20;

async function lastLiveAt(
  db: Queryable,
  chore: Pick<ChoreRow, "id" | "confirmMode">,
  now: Date,
): Promise<Date | null> {
  const rows = await db
    .select({
      id: completions.id,
      occurredAt: completions.occurredAt,
      loggedAt: completions.loggedAt,
      status: completions.status,
      finalizesAt: completions.finalizesAt,
      photoAttachedAt: completions.photoAttachedAt,
    })
    .from(completions)
    .where(
      and(eq(completions.choreId, chore.id), ne(completions.status, "voided")),
    )
    .orderBy(desc(completions.occurredAt), desc(completions.loggedAt))
    .limit(LAST_LIVE_SCAN);
  const live = rows.find((r) =>
    isLive({ ...r, confirmMode: chore.confirmMode }, now),
  );
  return live?.occurredAt ?? null;
}

/**
 * Every chore of the household with what the grid shows (SPEC §3.1): its
 * weight now, this season's streak holder and length, and when it was last
 * done. Archived chores only with `includeArchived`. Ordered by name.
 */
export async function listChoreBoard(
  db: Queryable,
  input: { householdId: string; now: Date; includeArchived?: boolean },
): Promise<ChoreBoardRow[]> {
  const rows = await db
    .select()
    .from(chores)
    .where(
      and(
        eq(chores.householdId, input.householdId),
        input.includeArchived ? undefined : sql`${chores.archivedAt} IS NULL`,
      ),
    )
    .orderBy(asc(sql`lower(${chores.name})`), asc(chores.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const versions = await db
    .select({
      id: choreRuleVersions.id,
      choreId: choreRuleVersions.choreId,
      effectiveFrom: choreRuleVersions.effectiveFrom,
      basePoints: choreRuleVersions.basePoints,
      cooldownMinutes: choreRuleVersions.cooldownMinutes,
    })
    .from(choreRuleVersions)
    .where(inArray(choreRuleVersions.choreId, ids));
  const versionsOf = new Map<string, RuleVersion[]>();
  for (const v of versions) {
    const list = versionsOf.get(v.choreId) ?? [];
    list.push(v);
    versionsOf.set(v.choreId, list);
  }

  // This season's streaks: the last scored completion of each chore in
  // replay order holds it, and its `streak_len` is the length.
  const season = await findSeason(db, input.householdId, seasonYear(input.now));
  const holders = season
    ? await db
        .selectDistinctOn([completions.choreId], {
          choreId: completions.choreId,
          holderId: completions.doneBy,
          holderName: members.displayName,
          length: completionScores.streakLen,
        })
        .from(completions)
        .innerJoin(
          completionScores,
          eq(completionScores.completionId, completions.id),
        )
        .innerJoin(members, eq(members.id, completions.doneBy))
        .where(
          and(
            eq(completions.seasonId, season.id),
            inArray(completions.choreId, ids),
          ),
        )
        .orderBy(
          completions.choreId,
          desc(completions.occurredAt),
          desc(completions.loggedAt),
          desc(completions.id),
        )
    : [];
  const streakOf = new Map(holders.map((h) => [h.choreId, h]));

  return Promise.all(
    rows.map(async (c) => {
      const list = versionsOf.get(c.id) ?? [];
      const inEffect = list.some(
        (v) => v.effectiveFrom.getTime() <= input.now.getTime(),
      )
        ? ruleVersionAt(list, input.now)
        : null;
      const h = streakOf.get(c.id);
      return {
        id: c.id,
        name: c.name,
        sprite: c.sprite,
        kind: c.kind,
        proofMode: c.proofMode,
        confirmMode: c.confirmMode,
        effortFactorPct: c.effortFactorPct,
        archivedAt: c.archivedAt,
        createdAt: c.createdAt,
        rule: inEffect
          ? {
              id: inEffect.id,
              basePoints: inEffect.basePoints,
              cooldownMinutes: inEffect.cooldownMinutes,
            }
          : null,
        streak: h
          ? { holderId: h.holderId, holderName: h.holderName, length: h.length }
          : null,
        lastDoneAt: await lastLiveAt(db, c, input.now),
      };
    }),
  );
}

/**
 * The ids and names of the chores that are not archived, by name. What the
 * Baumy command's system prompt lists (SPEC §6.3), without the board's
 * scoring reads.
 */
export async function listChoreNames(
  db: Queryable,
  householdId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: chores.id, name: chores.name })
    .from(chores)
    .where(
      and(
        eq(chores.householdId, householdId),
        sql`${chores.archivedAt} IS NULL`,
      ),
    )
    .orderBy(asc(sql`lower(${chores.name})`), asc(chores.id));
}

/** A chore of the household by id, row-locked for the change to follow. */
export async function lockChoreRow(
  db: Queryable,
  householdId: string,
  choreId: string,
): Promise<ChoreRow | null> {
  const [row] = await db
    .select()
    .from(chores)
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .for("update");
  return row ?? null;
}

/**
 * Whether another chore that is not archived already has this name, compared
 * without case. `exceptId` leaves out the chore being renamed.
 */
export async function choreNameTaken(
  db: Queryable,
  input: { householdId: string; name: string; exceptId?: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: chores.id })
    .from(chores)
    .where(
      and(
        eq(chores.householdId, input.householdId),
        sql`lower(${chores.name}) = lower(${input.name})`,
        sql`${chores.archivedAt} IS NULL`,
        input.exceptId ? ne(chores.id, input.exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface ChoreWeight {
  basePoints: number;
  cooldownMinutes: number;
}

/**
 * Put a weight in effect from `now` (a `manual` rule version by `createdBy`).
 * Two changes in the same instant keep the later one.
 */
async function putWeight(
  db: Queryable,
  input: {
    householdId: string;
    choreId: string;
    weight: ChoreWeight;
    createdBy: string;
    now: Date;
  },
): Promise<string> {
  const [version] = await db
    .insert(choreRuleVersions)
    .values({
      choreId: input.choreId,
      effectiveFrom: input.now,
      basePoints: input.weight.basePoints,
      cooldownMinutes: input.weight.cooldownMinutes,
      source: "manual",
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .onConflictDoUpdate({
      target: [choreRuleVersions.choreId, choreRuleVersions.effectiveFrom],
      set: {
        basePoints: input.weight.basePoints,
        cooldownMinutes: input.weight.cooldownMinutes,
        source: "manual",
        suggestionId: null,
        createdBy: input.createdBy,
      },
    })
    .returning({ id: choreRuleVersions.id });
  return version!.id;
}

/** Re-score the given seasons of a chore, or every season it has rows in. */
async function rescoreSeasons(
  db: Queryable,
  input: { householdId: string; choreId: string; now: Date },
  seasonIds?: string[],
): Promise<void> {
  const ids =
    seasonIds ??
    (
      await db
        .selectDistinct({ seasonId: completions.seasonId })
        .from(completions)
        .where(eq(completions.choreId, input.choreId))
        .orderBy(asc(completions.seasonId))
    ).map((r) => r.seasonId);
  for (const seasonId of ids) {
    await rescoreChore(db, { ...input, seasonId });
  }
}

export interface ChoreSettings {
  name: string;
  kind: ChoreKind;
  proofMode: ProofMode;
  confirmMode: ConfirmMode;
  effortFactorPct: number;
}

/** A new chore with its first (`manual`) rule version, in effect from `now`. */
export async function createChore(
  db: Queryable,
  input: ChoreSettings &
    ChoreWeight & {
      householdId: string;
      sprite: string;
      createdBy: string;
      now: Date;
    },
): Promise<ChoreRow> {
  const [chore] = await db
    .insert(chores)
    .values({
      householdId: input.householdId,
      name: input.name,
      sprite: input.sprite,
      kind: input.kind,
      proofMode: input.proofMode,
      confirmMode: input.confirmMode,
      effortFactorPct: input.effortFactorPct,
      createdAt: input.now,
    })
    .returning();
  await putWeight(db, {
    householdId: input.householdId,
    choreId: chore!.id,
    weight: {
      basePoints: input.basePoints,
      cooldownMinutes: input.cooldownMinutes,
    },
    createdBy: input.createdBy,
    now: input.now,
  });
  return chore!;
}

/**
 * Change a locked chore's settings, and its weight when `weight` differs from
 * the version in effect now. Returns the new row and whether a rule version
 * was added.
 *
 * Scores stay what a rebuild would make them:
 * - a new weight re-scores the current season, since a completion up to 2
 *   minutes "in the future" (SPEC §4.2) may fall after `now`;
 * - a new confirm mode re-scores every season of the chore, because whether
 *   a stored `pending` self-claim counts depends on it (SPEC §4.1). Switching
 *   to `partner` stops unconfirmed self-claims counting until someone
 *   confirms them; switching back counts them again.
 */
export async function updateChore(
  db: Queryable,
  input: {
    householdId: string;
    chore: ChoreRow;
    settings: Partial<ChoreSettings>;
    weight?: ChoreWeight;
    createdBy: string;
    now: Date;
  },
): Promise<{ chore: ChoreRow; weightChanged: boolean }> {
  const [row] = Object.keys(input.settings).length
    ? await db
        .update(chores)
        .set(input.settings)
        .where(eq(chores.id, input.chore.id))
        .returning()
    : [input.chore];

  let weightChanged = false;
  const next = input.weight;
  if (next) {
    const versions = await db
      .select({
        id: choreRuleVersions.id,
        effectiveFrom: choreRuleVersions.effectiveFrom,
        basePoints: choreRuleVersions.basePoints,
        cooldownMinutes: choreRuleVersions.cooldownMinutes,
      })
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.choreId, input.chore.id));
    const current = versions.some(
      (v) => v.effectiveFrom.getTime() <= input.now.getTime(),
    )
      ? ruleVersionAt(versions, input.now)
      : null;
    if (
      !current ||
      next.basePoints !== current.basePoints ||
      next.cooldownMinutes !== current.cooldownMinutes
    ) {
      await putWeight(db, {
        householdId: input.householdId,
        choreId: input.chore.id,
        weight: next,
        createdBy: input.createdBy,
        now: input.now,
      });
      weightChanged = true;
    }
  }

  const scope = {
    householdId: input.householdId,
    choreId: input.chore.id,
    now: input.now,
  };
  if (row!.confirmMode !== input.chore.confirmMode) {
    await rescoreSeasons(db, scope);
  } else if (weightChanged) {
    const season = await findSeason(
      db,
      input.householdId,
      seasonYear(input.now),
    );
    await rescoreSeasons(db, scope, season ? [season.id] : []);
  }
  return { chore: row!, weightChanged };
}

/** Archive (`archived: true`, keeping the first archive time) or restore. */
export async function setChoreArchived(
  db: Queryable,
  input: { chore: ChoreRow; archived: boolean; now: Date },
): Promise<ChoreRow> {
  const [row] = await db
    .update(chores)
    .set({
      archivedAt: input.archived ? (input.chore.archivedAt ?? input.now) : null,
    })
    .where(eq(chores.id, input.chore.id))
    .returning();
  return row!;
}
