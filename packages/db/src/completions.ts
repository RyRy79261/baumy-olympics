import {
  initialVerification,
  isCounted,
  isLive,
  replayChore,
  seasonBounds,
  seasonYear,
  validateNewCompletion,
  type CompletionScore,
  type CompletionStatus,
  type RuleVersion,
  type ValidationResult,
  type ValidatorCompletion,
  type VerificationRow,
} from "@baumy/core";
import type { Surface } from "@baumy/types";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { Queryable } from "./index";
import {
  choreRuleVersions,
  chores,
  completionScores,
  completions,
} from "./schema";
import { ensureSeason, findSeason } from "./seasons";

// The completion write path (SPEC §5 "Writes and transactions", AGENTS.md
// "Completion writes"). Every function takes the caller's transaction, which
// is `runAction`'s, and writes neither `audit_events` nor `action_requests`:
// runAction does that in the same transaction.
//
// Every write to a chore's completions first locks the chore row
// (`SELECT … FOR UPDATE`). That serialises writers per chore, so two people
// tapping Trash at once cannot both slip under the cooldown, and a re-score
// never interleaves with another write to the same chore. Writes to
// different chores do not wait for each other.
//
// Scores are never patched: after every write the whole (chore, season) is
// replayed by `replayChore` (packages/core) and `completion_scores` is made to
// match, so the table can always be dropped and rebuilt (`rebuildAllScores`).

export type CompletionRow = typeof completions.$inferSelect;
export type CompletionScoreRow = typeof completionScores.$inferSelect;
type ChoreRow = typeof chores.$inferSelect;

/**
 * How many stored-not-voided completions before the season start are looked
 * at to find the previous *live* one (for `COOLDOWN` across 1 Jan, E12).
 * Only a disputed row that timed out or an expired partner-mode claim can be
 * non-live without being stored as voided, so the first few rows decide it.
 */
const PREVIOUS_LIVE_SCAN = 20;

export interface LogCompletionInput {
  householdId: string;
  choreId: string;
  doneBy: string;
  loggedBy: string;
  occurredAt: Date;
  source: Surface;
  /** The caller's idempotency key; a repeat returns the stored completion. */
  clientRequestId: string;
  /** From the caller's clock (`lib/clock.ts`). */
  now: Date;
  note?: string | null;
  /** A Blob pathname already uploaded for this claim. */
  photoPathname?: string | null;
  /**
   * The id to give the new completion. The photo upload route picks it
   * before logging, because the photo is stored under `completions/{id}/`.
   */
  completionId?: string;
}

export type LogCompletionFailure =
  | Extract<ValidationResult, { ok: false }>
  /** No such chore in this household. */
  | { ok: false; code: "CHORE_NOT_FOUND" }
  /** The chore has no rule version in effect at `occurredAt`. */
  | { ok: false; code: "NO_RULE_VERSION" }
  /** The request id already names a different completion. */
  | { ok: false; code: "REQUEST_ID_REUSED" };

export type LogCompletionResult =
  | {
      ok: true;
      /** True when `clientRequestId` was seen before: nothing was written. */
      duplicate: boolean;
      completion: CompletionRow;
      /** Null while the completion is not counted (partner-mode pending). */
      score: CompletionScoreRow | null;
    }
  | LogCompletionFailure;

/** `SELECT … FROM chores WHERE id = $1 FOR UPDATE`, scoped to the household. */
async function lockChore(
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

export async function loadRuleVersions(
  db: Queryable,
  choreId: string,
): Promise<RuleVersion[]> {
  return db
    .select({
      id: choreRuleVersions.id,
      effectiveFrom: choreRuleVersions.effectiveFrom,
      basePoints: choreRuleVersions.basePoints,
      cooldownMinutes: choreRuleVersions.cooldownMinutes,
    })
    .from(choreRuleVersions)
    .where(eq(choreRuleVersions.choreId, choreId));
}

const validatorColumns = {
  id: completions.id,
  occurredAt: completions.occurredAt,
  loggedAt: completions.loggedAt,
  status: completions.status,
  finalizesAt: completions.finalizesAt,
  photoAttachedAt: completions.photoAttachedAt,
};

/**
 * What the validator needs (SPEC §4.2): the chore's live completions from
 * `seasonStart` on, plus the previous live one before it. Rows stored as
 * `voided` are never live, so they are not loaded; the rest are judged at
 * `now` with `isLive`.
 */
async function loadLiveCompletions(
  db: Queryable,
  chore: ChoreRow,
  seasonStart: Date,
  now: Date,
): Promise<ValidatorCompletion[]> {
  const withMode = (r: Omit<ValidatorCompletion, "confirmMode">) => ({
    ...r,
    confirmMode: chore.confirmMode,
  });
  const inSeason = await db
    .select(validatorColumns)
    .from(completions)
    .where(
      and(
        eq(completions.choreId, chore.id),
        gte(completions.occurredAt, seasonStart),
        ne(completions.status, "voided"),
      ),
    );
  const before = await db
    .select(validatorColumns)
    .from(completions)
    .where(
      and(
        eq(completions.choreId, chore.id),
        lt(completions.occurredAt, seasonStart),
        ne(completions.status, "voided"),
      ),
    )
    .orderBy(desc(completions.occurredAt), desc(completions.loggedAt))
    .limit(PREVIOUS_LIVE_SCAN);
  const previous = before.map(withMode).find((c) => isLive(c, now));
  const live = inSeason.map(withMode).filter((c) => isLive(c, now));
  return previous ? [previous, ...live] : live;
}

async function findByRequestId(
  db: Queryable,
  householdId: string,
  clientRequestId: string,
): Promise<CompletionRow | null> {
  const [row] = await db
    .select()
    .from(completions)
    .where(
      and(
        eq(completions.householdId, householdId),
        eq(completions.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function scoreFor(
  db: Queryable,
  completionId: string,
): Promise<CompletionScoreRow | null> {
  const [row] = await db
    .select()
    .from(completionScores)
    .where(eq(completionScores.completionId, completionId))
    .limit(1);
  return row ?? null;
}

/**
 * A repeat of `clientRequestId` gets the completion it made, as long as it
 * asks for the same thing (chore and doer); anything else is refused rather
 * than silently answered with someone else's completion.
 */
async function replayDuplicate(
  db: Queryable,
  existing: CompletionRow,
  input: LogCompletionInput,
): Promise<LogCompletionResult> {
  if (existing.choreId !== input.choreId || existing.doneBy !== input.doneBy) {
    return { ok: false, code: "REQUEST_ID_REUSED" };
  }
  return {
    ok: true,
    duplicate: true,
    completion: existing,
    score: await scoreFor(db, existing.id),
  };
}

/**
 * Log that `doneBy` did a chore (SPEC §5): lock the chore, load the live
 * completions for the season plus the previous live one, validate, insert,
 * replay the (chore, season) and upsert its scores. All in the caller's
 * transaction; a failure writes nothing.
 */
export async function logCompletion(
  db: Queryable,
  input: LogCompletionInput,
): Promise<LogCompletionResult> {
  const chore = await lockChore(db, input.householdId, input.choreId);
  if (!chore) return { ok: false, code: "CHORE_NOT_FOUND" };

  // Checked under the lock: a concurrent repeat of this request on this chore
  // has committed by now, so it is seen here rather than logged twice.
  const existing = await findByRequestId(
    db,
    input.householdId,
    input.clientRequestId,
  );
  if (existing) return replayDuplicate(db, existing, input);

  const ruleVersions = await loadRuleVersions(db, chore.id);
  if (
    !ruleVersions.some(
      (v) => v.effectiveFrom.getTime() <= input.occurredAt.getTime(),
    )
  ) {
    return { ok: false, code: "NO_RULE_VERSION" };
  }

  const year = seasonYear(input.occurredAt);
  const known = await findSeason(db, input.householdId, year);
  const verdict = validateNewCompletion({
    now: input.now,
    occurredAt: input.occurredAt,
    chore: { archivedAt: chore.archivedAt, proofMode: chore.proofMode },
    hasPhoto: Boolean(input.photoPathname),
    // A season nobody has created yet is about to be created active.
    seasonStatus: known?.status ?? "active",
    ruleVersions,
    completions: await loadLiveCompletions(
      db,
      chore,
      seasonBounds(year).startsAt,
      input.now,
    ),
  });
  if (!verdict.ok) return verdict;

  const season =
    known ??
    (await ensureSeason(db, {
      householdId: input.householdId,
      year,
      now: input.now,
    }));
  const photoAttachedAt = input.photoPathname ? input.now : null;
  const v = initialVerification({
    doneBy: input.doneBy,
    loggedBy: input.loggedBy,
    confirmMode: chore.confirmMode,
    loggedAt: input.now,
    photoAttachedAt,
  });

  const [inserted] = await db
    .insert(completions)
    .values({
      ...(input.completionId ? { id: input.completionId } : {}),
      householdId: input.householdId,
      choreId: chore.id,
      seasonId: season.id,
      doneBy: input.doneBy,
      loggedBy: input.loggedBy,
      occurredAt: input.occurredAt,
      loggedAt: input.now,
      source: input.source,
      status: v.status,
      verifiedBy: v.verifiedBy,
      verifiedAt: v.verifiedAt,
      finalizesAt: v.finalizesAt,
      photoPathname: input.photoPathname ?? null,
      photoAttachedAt,
      note: input.note ?? null,
      voidReason: null,
      clientRequestId: input.clientRequestId,
    })
    // The same request id racing on a DIFFERENT chore holds another lock, so
    // it meets this one here, at the unique index, instead.
    .onConflictDoNothing({
      target: [completions.householdId, completions.clientRequestId],
    })
    .returning();
  if (!inserted) {
    const winner = await findByRequestId(
      db,
      input.householdId,
      input.clientRequestId,
    );
    if (!winner) throw new Error("Completion request id vanished mid-insert.");
    return replayDuplicate(db, winner, input);
  }

  const scores = await rescoreLocked(db, chore, season.id, input.now);
  return {
    ok: true,
    duplicate: false,
    completion: inserted,
    score: scores.find((s) => s.completionId === inserted.id) ?? null,
  };
}

export type PreviewCompletionResult =
  | {
      ok: true;
      choreName: string;
      /** What the completion would score, as `logCompletion` would store it. */
      score: CompletionScore;
      /**
       * False for a partner-mode self-claim: it scores nothing until another
       * member confirms it, and then scores `score` if nothing changed.
       */
      counted: boolean;
    }
  | Exclude<LogCompletionFailure, { code: "REQUEST_ID_REUSED" }>;

/** Stands in for the not-yet-inserted completion in the preview's replay. */
const PREVIEW_ID = "preview";

/**
 * What `logCompletion` would do with this completion now, without writing or
 * locking anything: the same validation, then the same replay of the
 * (chore, season) with the completion appended. The number a person approves
 * ("+25, streak 2") is therefore the number stored, unless someone logs the
 * same chore in between.
 */
export async function previewCompletion(
  db: Queryable,
  input: Omit<LogCompletionInput, "source" | "clientRequestId">,
): Promise<PreviewCompletionResult> {
  const [chore] = await db
    .select()
    .from(chores)
    .where(
      and(
        eq(chores.id, input.choreId),
        eq(chores.householdId, input.householdId),
      ),
    )
    .limit(1);
  if (!chore) return { ok: false, code: "CHORE_NOT_FOUND" };
  const ruleVersions = await loadRuleVersions(db, chore.id);
  if (
    !ruleVersions.some(
      (v) => v.effectiveFrom.getTime() <= input.occurredAt.getTime(),
    )
  ) {
    return { ok: false, code: "NO_RULE_VERSION" };
  }
  const year = seasonYear(input.occurredAt);
  const season = await findSeason(db, input.householdId, year);
  const verdict = validateNewCompletion({
    now: input.now,
    occurredAt: input.occurredAt,
    chore: { archivedAt: chore.archivedAt, proofMode: chore.proofMode },
    hasPhoto: Boolean(input.photoPathname),
    seasonStatus: season?.status ?? "active",
    ruleVersions,
    completions: await loadLiveCompletions(
      db,
      chore,
      seasonBounds(year).startsAt,
      input.now,
    ),
  });
  if (!verdict.ok) return verdict;

  const rows = season
    ? await db
        .select({
          id: completions.id,
          doneBy: completions.doneBy,
          occurredAt: completions.occurredAt,
          loggedAt: completions.loggedAt,
          status: completions.status,
        })
        .from(completions)
        .where(
          and(
            eq(completions.choreId, chore.id),
            eq(completions.seasonId, season.id),
          ),
        )
    : [];
  const v = initialVerification({
    doneBy: input.doneBy,
    loggedBy: input.loggedBy,
    confirmMode: chore.confirmMode,
    loggedAt: input.now,
    photoAttachedAt: input.photoPathname ? input.now : null,
  });
  const counted = isCounted({
    status: v.status,
    confirmMode: chore.confirmMode,
  });
  const scores = replayChore(
    [
      ...rows.map((r) => ({ ...r, confirmMode: chore.confirmMode })),
      {
        id: PREVIEW_ID,
        doneBy: input.doneBy,
        occurredAt: input.occurredAt,
        loggedAt: input.now,
        // Scored as if counted; `counted` says whether it will be yet.
        status: "confirmed",
        confirmMode: chore.confirmMode,
      },
    ],
    ruleVersions,
  );
  const score = scores.find((s) => s.completionId === PREVIEW_ID)!;
  return { ok: true, choreName: chore.name, score, counted };
}

function toRow(score: CompletionScore, now: Date): CompletionScoreRow {
  return { ...score, computedAt: now };
}

/**
 * The (chore, season) replay and upsert, with the chore already locked by the
 * caller (`lockChoreRow`). For the other completion write paths in this
 * package (confirmations.ts); everything else calls `rescoreChore`.
 */
export async function rescoreLocked(
  db: Queryable,
  chore: ChoreRow,
  seasonId: string,
  now: Date,
): Promise<CompletionScoreRow[]> {
  const rows = await db
    .select({
      id: completions.id,
      doneBy: completions.doneBy,
      occurredAt: completions.occurredAt,
      loggedAt: completions.loggedAt,
      status: completions.status,
    })
    .from(completions)
    .where(
      and(
        eq(completions.choreId, chore.id),
        eq(completions.seasonId, seasonId),
      ),
    );
  const ruleVersions = await loadRuleVersions(db, chore.id);
  const scores = replayChore(
    rows.map((r) => ({ ...r, confirmMode: chore.confirmMode })),
    ruleVersions,
  ).map((s) => toRow(s, now));

  const ofThisChoreSeason = db
    .select({ id: completions.id })
    .from(completions)
    .where(
      and(
        eq(completions.choreId, chore.id),
        eq(completions.seasonId, seasonId),
      ),
    );
  // Rows no longer counted (voided, disputed) lose their score.
  const keep = scores.map((s) => s.completionId);
  await db
    .delete(completionScores)
    .where(
      and(
        inArray(completionScores.completionId, ofThisChoreSeason),
        keep.length > 0
          ? notInArray(completionScores.completionId, keep)
          : undefined,
      ),
    );
  if (scores.length > 0) {
    await db
      .insert(completionScores)
      .values(scores)
      .onConflictDoUpdate({
        target: completionScores.completionId,
        set: {
          ruleVersionId: sql`excluded.rule_version_id`,
          rulesetVersion: sql`excluded.ruleset_version`,
          streakLen: sql`excluded.streak_len`,
          multiplierPct: sql`excluded.multiplier_pct`,
          basePts: sql`excluded.base_pts`,
          streakPts: sql`excluded.streak_pts`,
          brokenMemberId: sql`excluded.broken_member_id`,
          brokenLen: sql`excluded.broken_len`,
          breakPts: sql`excluded.break_pts`,
          totalPts: sql`excluded.total_pts`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
  return scores;
}

/**
 * Rebuild the scores of one (chore, season) from its completions and rule
 * versions. Locks the chore first, like every other write to it. Returns the
 * scores in replay order.
 */
export async function rescoreChore(
  db: Queryable,
  input: { householdId: string; choreId: string; seasonId: string; now: Date },
): Promise<CompletionScoreRow[]> {
  const chore = await lockChore(db, input.householdId, input.choreId);
  if (!chore) throw new Error(`Chore ${input.choreId} not found.`);
  return rescoreLocked(db, chore, input.seasonId, input.now);
}

/**
 * Rebuild every (chore, season) of the household, in chore order so two
 * rebuilds cannot deadlock on each other's locks. For recovery and for the
 * "scores are always rebuildable" guarantee; returns how many pairs it did.
 */
export async function rebuildAllScores(
  db: Queryable,
  input: { householdId: string; now: Date },
): Promise<number> {
  const pairs = await db
    .selectDistinct({
      choreId: completions.choreId,
      seasonId: completions.seasonId,
    })
    .from(completions)
    .where(eq(completions.householdId, input.householdId))
    .orderBy(asc(completions.choreId), asc(completions.seasonId));
  for (const p of pairs) {
    await rescoreChore(db, { ...input, ...p });
  }
  return pairs.length;
}

/** The columns a verification event may change (packages/core `transition`). */
export type CompletionStatusFields = Pick<
  VerificationRow,
  "status" | "voidReason" | "verifiedBy" | "verifiedAt" | "finalizesAt"
>;

export type SetCompletionStatusResult =
  | { ok: true; completion: CompletionRow }
  | { ok: false; code: "NOT_FOUND" }
  /** The stored status is no longer `expectedStatus`: someone got there first. */
  | { ok: false; code: "STALE" };

/**
 * Compare-and-set a completion's verification fields (SPEC §4.3): the update
 * applies only while the stored status is still `expectedStatus`, then the
 * (chore, season) is re-scored, since the counted set may have changed. The
 * chore is locked first, so this never interleaves with a `logCompletion`.
 */
export async function setCompletionStatus(
  db: Queryable,
  input: {
    householdId: string;
    completionId: string;
    expectedStatus: CompletionStatus;
    next: CompletionStatusFields;
    now: Date;
  },
): Promise<SetCompletionStatusResult> {
  const [target] = await db
    .select({ choreId: completions.choreId, seasonId: completions.seasonId })
    .from(completions)
    .where(
      and(
        eq(completions.id, input.completionId),
        eq(completions.householdId, input.householdId),
      ),
    )
    .limit(1);
  if (!target) return { ok: false, code: "NOT_FOUND" };
  const chore = await lockChore(db, input.householdId, target.choreId);
  if (!chore) return { ok: false, code: "NOT_FOUND" };

  const [updated] = await db
    .update(completions)
    .set({
      status: input.next.status,
      voidReason: input.next.voidReason,
      verifiedBy: input.next.verifiedBy,
      verifiedAt: input.next.verifiedAt,
      finalizesAt: input.next.finalizesAt,
    })
    .where(
      and(
        eq(completions.id, input.completionId),
        eq(completions.status, input.expectedStatus),
      ),
    )
    .returning();
  if (!updated) return { ok: false, code: "STALE" };

  await rescoreLocked(db, chore, target.seasonId, input.now);
  return { ok: true, completion: updated };
}
