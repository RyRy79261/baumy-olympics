import type { CompletionStatus, ConfirmMode, PrizeMode } from "@baumy/core";
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  isNull,
  lt,
} from "drizzle-orm";
import type { Queryable } from "./index";
import {
  chores,
  completionScores,
  completions,
  disputes,
  members,
  pointAdjustments,
  potContributions,
  seasons,
} from "./schema";
import type { SeasonRow } from "./seasons";

// The scoreboard, the streak board and the pot (SPEC §4.5): reads of one
// season's stored scores, adjustments and pot contributions, and the writes
// behind `adjust_points`, `add_pot_contribution` and `set_prize_mode`. Every
// function takes the caller's handle; the writes run in runAction's
// transaction and write neither `audit_events` nor `action_requests`.

/**
 * A counted completion of the season with its stored score. Only counted
 * completions have a `completion_scores` row, so this is exactly what the
 * standings add up.
 */
export interface ScoredCompletion {
  id: string;
  choreId: string;
  choreName: string;
  doneBy: string;
  loggedBy: string;
  occurredAt: Date;
  loggedAt: Date;
  status: CompletionStatus;
  confirmMode: ConfirmMode;
  finalizesAt: Date | null;
  photoAttachedAt: Date | null;
  verifiedBy: string | null;
  streakLen: number;
  multiplierPct: number;
  basePts: number;
  streakPts: number;
  brokenMemberId: string | null;
  brokenLen: number | null;
  breakPts: number;
  totalPts: number;
}

/** Every scored completion of a season, in replay order. */
export async function listSeasonScores(
  db: Queryable,
  seasonId: string,
): Promise<ScoredCompletion[]> {
  return db
    .select({
      id: completions.id,
      choreId: completions.choreId,
      choreName: chores.name,
      doneBy: completions.doneBy,
      loggedBy: completions.loggedBy,
      occurredAt: completions.occurredAt,
      loggedAt: completions.loggedAt,
      status: completions.status,
      confirmMode: chores.confirmMode,
      finalizesAt: completions.finalizesAt,
      photoAttachedAt: completions.photoAttachedAt,
      verifiedBy: completions.verifiedBy,
      streakLen: completionScores.streakLen,
      multiplierPct: completionScores.multiplierPct,
      basePts: completionScores.basePts,
      streakPts: completionScores.streakPts,
      brokenMemberId: completionScores.brokenMemberId,
      brokenLen: completionScores.brokenLen,
      breakPts: completionScores.breakPts,
      totalPts: completionScores.totalPts,
    })
    .from(completions)
    .innerJoin(
      completionScores,
      eq(completionScores.completionId, completions.id),
    )
    .innerJoin(chores, eq(chores.id, completions.choreId))
    .where(eq(completions.seasonId, seasonId))
    .orderBy(
      asc(completions.occurredAt),
      asc(completions.loggedAt),
      asc(completions.id),
    );
}

/** Whether the season has any completion at all, in any status. */
export async function seasonHasCompletions(
  db: Queryable,
  seasonId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: completions.id })
    .from(completions)
    .where(eq(completions.seasonId, seasonId))
    .limit(1);
  return Boolean(row);
}

/** How many disputes each member raised and had raised against them. */
export interface DisputeCount {
  memberId: string;
  raised: number;
  against: number;
}

/**
 * Disputes opened in `[since, until)` on the household's completions, per
 * member: `raised` by them, and `against` their claims.
 */
export async function countDisputes(
  db: Queryable,
  input: { householdId: string; since: Date; until: Date },
): Promise<DisputeCount[]> {
  const inRange = and(
    eq(completions.householdId, input.householdId),
    gte(disputes.createdAt, input.since),
    lt(disputes.createdAt, input.until),
  );
  const raised = await db
    .select({ memberId: disputes.raisedBy, n: count() })
    .from(disputes)
    .innerJoin(completions, eq(completions.id, disputes.completionId))
    .where(inRange)
    .groupBy(disputes.raisedBy);
  const against = await db
    .select({ memberId: completions.doneBy, n: count() })
    .from(disputes)
    .innerJoin(completions, eq(completions.id, disputes.completionId))
    .where(inRange)
    .groupBy(completions.doneBy);

  const out = new Map<string, DisputeCount>();
  const entry = (memberId: string) => {
    let e = out.get(memberId);
    if (!e) {
      e = { memberId, raised: 0, against: 0 };
      out.set(memberId, e);
    }
    return e;
  };
  for (const r of raised) entry(r.memberId).raised = r.n;
  for (const r of against) entry(r.memberId).against = r.n;
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export type AdjustmentRow = typeof pointAdjustments.$inferSelect;

/** An adjustment with the names people see. */
export interface AdjustmentListing extends AdjustmentRow {
  memberName: string;
  createdByName: string;
  approvedByName: string | null;
}

const creator = aliasedTable(members, "adjustment_creator");
const approver = aliasedTable(members, "adjustment_approver");

/** A season's adjustments, newest first. */
export async function listSeasonAdjustments(
  db: Queryable,
  seasonId: string,
): Promise<AdjustmentListing[]> {
  return db
    .select({
      ...getTableColumns(pointAdjustments),
      memberName: members.displayName,
      createdByName: creator.displayName,
      approvedByName: approver.displayName,
    })
    .from(pointAdjustments)
    .innerJoin(members, eq(members.id, pointAdjustments.memberId))
    .innerJoin(creator, eq(creator.id, pointAdjustments.createdBy))
    .leftJoin(approver, eq(approver.id, pointAdjustments.approvedBy))
    .where(eq(pointAdjustments.seasonId, seasonId))
    .orderBy(desc(pointAdjustments.createdAt), desc(pointAdjustments.id));
}

/** A new, unapproved adjustment. It counts once a second admin approves it. */
export async function createAdjustment(
  db: Queryable,
  input: {
    seasonId: string;
    memberId: string;
    points: number;
    reason: string;
    createdBy: string;
    now: Date;
  },
): Promise<AdjustmentRow> {
  const [row] = await db
    .insert(pointAdjustments)
    .values({
      seasonId: input.seasonId,
      memberId: input.memberId,
      points: input.points,
      reason: input.reason,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .returning();
  return row!;
}

/** An adjustment of the household, row-locked, with its season. */
export async function lockAdjustment(
  db: Queryable,
  householdId: string,
  adjustmentId: string,
): Promise<{ adjustment: AdjustmentRow; season: SeasonRow } | null> {
  const [row] = await db
    .select({ adjustment: pointAdjustments, season: seasons })
    .from(pointAdjustments)
    .innerJoin(seasons, eq(seasons.id, pointAdjustments.seasonId))
    .where(
      and(
        eq(pointAdjustments.id, adjustmentId),
        eq(seasons.householdId, householdId),
      ),
    )
    .for("update", { of: pointAdjustments });
  return row ?? null;
}

/**
 * Approve an adjustment: a compare-and-set on `approved_by IS NULL`, so of
 * two approvals at once only one lands (null for the other). Approving your
 * own adjustment is refused by the `point_adjustments_approver_not_creator`
 * check constraint, which throws; callers say so before trying.
 */
export async function approveAdjustment(
  db: Queryable,
  input: { adjustmentId: string; approvedBy: string; now: Date },
): Promise<AdjustmentRow | null> {
  const [row] = await db
    .update(pointAdjustments)
    .set({ approvedBy: input.approvedBy, approvedAt: input.now })
    .where(
      and(
        eq(pointAdjustments.id, input.adjustmentId),
        isNull(pointAdjustments.approvedBy),
      ),
    )
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// The pot
// ---------------------------------------------------------------------------

export type PotContributionRow = typeof potContributions.$inferSelect;

export interface PotContributionListing extends PotContributionRow {
  contributedByName: string;
}

/** A season's pot contributions, by month, then in the order they came in. */
export async function listPotContributions(
  db: Queryable,
  seasonId: string,
): Promise<PotContributionListing[]> {
  const rows = await db
    .select({ row: potContributions, name: members.displayName })
    .from(potContributions)
    .innerJoin(members, eq(members.id, potContributions.contributedBy))
    .where(eq(potContributions.seasonId, seasonId))
    .orderBy(
      asc(potContributions.month),
      asc(potContributions.createdAt),
      asc(potContributions.id),
    );
  return rows.map((r) => ({ ...r.row, contributedByName: r.name }));
}

export async function addPotContribution(
  db: Queryable,
  input: {
    seasonId: string;
    /** The 1st of the month, "YYYY-MM-01". */
    month: string;
    amountCents: number;
    contributedBy: string;
    note: string | null;
    now: Date;
  },
): Promise<PotContributionRow> {
  const [row] = await db
    .insert(potContributions)
    .values({
      seasonId: input.seasonId,
      month: input.month,
      amountCents: input.amountCents,
      contributedBy: input.contributedBy,
      note: input.note,
      createdAt: input.now,
    })
    .returning();
  return row!;
}

// ---------------------------------------------------------------------------
// Prize mode
// ---------------------------------------------------------------------------

export type SetPrizeModeResult =
  { ok: true; season: SeasonRow } | { ok: false; code: "PRIZE_MODE_LOCKED" };

/**
 * Set a season's prize mode (SPEC §4.5). With `lockOnFirstCompletion`, a
 * season that already has a completion is refused with PRIZE_MODE_LOCKED.
 *
 * The season row is locked `FOR UPDATE` before the completions are counted.
 * A completion insert takes a `KEY SHARE` lock on its season (the foreign
 * key), which conflicts with that: a completion being logged at the same
 * moment either commits first, and is seen by the count, or waits until the
 * mode is set.
 */
export async function setPrizeMode(
  db: Queryable,
  input: { seasonId: string; mode: PrizeMode; lockOnFirstCompletion: boolean },
): Promise<SetPrizeModeResult> {
  const [locked] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.id, input.seasonId))
    .for("update");
  if (!locked) throw new Error(`Season ${input.seasonId} not found.`);
  if (
    input.lockOnFirstCompletion &&
    (await seasonHasCompletions(db, input.seasonId))
  ) {
    return { ok: false, code: "PRIZE_MODE_LOCKED" };
  }
  const [season] = await db
    .update(seasons)
    .set({ prizeMode: input.mode })
    .where(eq(seasons.id, input.seasonId))
    .returning();
  return { ok: true, season: season! };
}
