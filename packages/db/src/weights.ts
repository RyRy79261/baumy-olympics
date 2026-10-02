import {
  changeSpacingOk,
  effectiveStatus,
  measureIntervals,
  referenceIntervalMinutes,
  ruleVersionAt,
  seasonYear,
  startOfBerlinWeek,
  suggestWeights,
  type IntervalMeasurement,
  type RuleVersion,
  type WeightVerdict,
} from "@baumy/core";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { Queryable } from "./index";
import type { ChoreRow } from "./chores";
import { loadRuleVersions, rescoreLocked } from "./completions";
import {
  choreRuleVersions,
  chores,
  completions,
  disputes,
  members,
  weightSuggestions,
} from "./schema";
import { findSeason } from "./seasons";

// Frequency-derived weights (SPEC §4.4): measure how often each chore is
// really done, store a suggestion when the weight should move, and apply the
// scheduled ones nobody vetoed.
//
// - `computeSuggestions(tx, now)` and `applyDueSuggestions(tx, now)` are for
//   the daily job (issue #18), which calls them on Mondays in Berlin. Both are
//   idempotent: a chore gets at most one suggestion per Berlin week, and a
//   suggestion applies at most once (compare-and-set on `scheduled`, plus the
//   unique `chore_rule_versions.suggestion_id`).
// - The admin writes (`schedule_weight`, `dismiss_weight`) and `veto_weight`
//   lock the suggestion row and compare-and-set its status.
// - An admin may also set any points by hand (`schedule_points_change`,
//   issue #115): an `admin` row, scheduled at once, which lands, is vetoed or
//   is cancelled like a scheduled suggestion. `listPointsHistory` reads the
//   whole story back from these rows and `chore_rule_versions`.
//
// Every function takes the caller's handle and writes neither `audit_events`
// nor `action_requests`.

export type WeightSuggestionRow = typeof weightSuggestions.$inferSelect;

/**
 * `occurred_at` of the chore's completions that count towards its natural
 * interval: finalized or confirmed at `now` (`effectiveStatus`), and never
 * disputed, whoever did them, from `since` up to `now`.
 */
export async function loadIntervalSamples(
  db: Queryable,
  input: {
    chore: Pick<ChoreRow, "id">;
    since: Date;
    now: Date;
  },
): Promise<Date[]> {
  const rows = await db
    .select({
      occurredAt: completions.occurredAt,
      loggedAt: completions.loggedAt,
      status: completions.status,
      finalizesAt: completions.finalizesAt,
      photoAttachedAt: completions.photoAttachedAt,
    })
    .from(completions)
    .where(
      and(
        eq(completions.choreId, input.chore.id),
        inArray(completions.status, ["pending", "confirmed", "finalized"]),
        gte(completions.occurredAt, input.since),
        lte(completions.occurredAt, input.now),
        notExists(
          db
            .select({ id: disputes.id })
            .from(disputes)
            .where(eq(disputes.completionId, completions.id)),
        ),
      ),
    )
    .orderBy(asc(completions.occurredAt));
  return rows
    .filter((r) => {
      const s = effectiveStatus(r, input.now);
      return s === "finalized" || s === "confirmed";
    })
    .map((r) => r.occurredAt);
}

/**
 * The median the chore's latest measured suggestion found, if any. An
 * admin's change measured nothing, so it is skipped.
 */
async function previousMedian(
  db: Queryable,
  choreId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ m: weightSuggestions.medianIntervalMinutes })
    .from(weightSuggestions)
    .where(
      and(
        eq(weightSuggestions.choreId, choreId),
        eq(weightSuggestions.origin, "measured"),
      ),
    )
    .orderBy(desc(weightSuggestions.computedAt))
    .limit(1);
  return row?.m ?? null;
}

/** `applies_at` of the chore's last applied suggestion, if any. */
export async function lastAppliedAt(
  db: Queryable,
  choreId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(weightSuggestions.appliesAt) })
    .from(weightSuggestions)
    .where(
      and(
        eq(weightSuggestions.choreId, choreId),
        eq(weightSuggestions.status, "applied"),
      ),
    );
  return row?.at ?? null;
}

function ruleNow(versions: RuleVersion[], now: Date): RuleVersion | null {
  return versions.some((v) => v.effectiveFrom.getTime() <= now.getTime())
    ? ruleVersionAt(versions, now)
    : null;
}

export interface ChoreMeasurement {
  rule: RuleVersion;
  referenceMinutes: number;
  measurement: IntervalMeasurement;
  verdict: WeightVerdict;
}

/**
 * Measure one chore at `now` (SPEC §4.4). Null when no rule version is in
 * effect yet, since there is no current weight to compare with.
 */
export async function measureChore(
  db: Queryable,
  chore: Pick<ChoreRow, "id" | "effortFactorPct">,
  now: Date,
): Promise<ChoreMeasurement | null> {
  const rule = ruleNow(await loadRuleVersions(db, chore.id), now);
  if (!rule) return null;
  const referenceMinutes = referenceIntervalMinutes({
    previousMedianMinutes: await previousMedian(db, chore.id),
    basePoints: rule.basePoints,
    effortFactorPct: chore.effortFactorPct,
  });
  // The window only depends on the reference, so load just that range.
  const probe = measureIntervals({
    completedAt: [],
    now,
    referenceMinutes,
    cooldownMinutes: rule.cooldownMinutes,
  });
  const completedAt = await loadIntervalSamples(db, {
    chore,
    since: probe.windowStart,
    now,
  });
  const measurement = measureIntervals({
    completedAt,
    now,
    referenceMinutes,
    cooldownMinutes: rule.cooldownMinutes,
  });
  const verdict = suggestWeights({
    measurement,
    currentPoints: rule.basePoints,
    effortFactorPct: chore.effortFactorPct,
  });
  return { rule, referenceMinutes, measurement, verdict };
}

export interface ComputeSuggestionsResult {
  /** Chores measured this run. */
  measured: number;
  /** Suggestions stored this run. */
  suggested: WeightSuggestionRow[];
}

/**
 * The weekly recompute (SPEC §4.4). For every chore that is not archived, in
 * id order, under its row lock: skip it if it already has this Berlin week's
 * measured suggestion or a scheduled change (an admin's too); otherwise supersede its open suggestion
 * (the numbers are a week old) and store a new one if the weight should move.
 * Every household unless `scope.householdId` narrows it (tests).
 */
export async function computeSuggestions(
  db: Queryable,
  now: Date,
  scope: { householdId?: string } = {},
): Promise<ComputeSuggestionsResult> {
  const weekStart = startOfBerlinWeek(now);
  const ids = await db
    .select({ id: chores.id })
    .from(chores)
    .where(
      and(
        isNull(chores.archivedAt),
        scope.householdId
          ? eq(chores.householdId, scope.householdId)
          : undefined,
      ),
    )
    .orderBy(asc(chores.id));
  let measured = 0;
  const suggested: WeightSuggestionRow[] = [];
  for (const { id } of ids) {
    const [chore] = await db
      .select()
      .from(chores)
      .where(and(eq(chores.id, id), isNull(chores.archivedAt)))
      .for("update");
    if (!chore) continue;
    const [busy] = await db
      .select({ id: weightSuggestions.id })
      .from(weightSuggestions)
      .where(
        and(
          eq(weightSuggestions.choreId, id),
          or(
            and(
              eq(weightSuggestions.origin, "measured"),
              eq(weightSuggestions.weekStart, weekStart),
            ),
            eq(weightSuggestions.status, "scheduled"),
          ),
        ),
      )
      .limit(1);
    if (busy) continue;
    const m = await measureChore(db, chore, now);
    if (!m) continue;
    measured += 1;
    await db
      .update(weightSuggestions)
      .set({ status: "superseded" })
      .where(
        and(
          eq(weightSuggestions.choreId, id),
          eq(weightSuggestions.status, "open"),
        ),
      );
    if (m.verdict.kind !== "suggest") continue;
    const [row] = await db
      .insert(weightSuggestions)
      .values({
        householdId: chore.householdId,
        choreId: id,
        weekStart,
        computedAt: now,
        windowStart: m.measurement.windowStart,
        windowEnd: m.measurement.windowEnd,
        sampleIntervals: m.measurement.intervals,
        medianIntervalMinutes: m.verdict.medianMinutes,
        rawPoints: m.verdict.rawPoints,
        currentPoints: m.rule.basePoints,
        currentCooldownMinutes: m.rule.cooldownMinutes,
        suggestedPoints: m.verdict.suggestedPoints,
        suggestedCooldownMinutes: m.verdict.cooldownMinutes,
      })
      .onConflictDoNothing({
        target: [weightSuggestions.choreId, weightSuggestions.weekStart],
        where: sql`${weightSuggestions.origin} = 'measured'`,
      })
      .returning();
    if (row) suggested.push(row);
  }
  return { measured, suggested };
}

export interface AppliedSuggestion {
  suggestionId: string;
  choreId: string;
  ruleVersionId: string;
  basePoints: number;
  cooldownMinutes: number;
}

/**
 * Apply every scheduled suggestion whose `applies_at` has passed (SPEC §4.4):
 * a `suggestion` rule version effective from `now`, so no completion that has
 * already happened changes score, then the suggestion becomes `applied`.
 * Claimed with `FOR UPDATE SKIP LOCKED`, so two runs never apply one twice; a
 * vetoed or dismissed suggestion is never selected. A measured change that
 * would land within 28 days of the chore's last one stays scheduled (the
 * schedule already pushes `applies_at` past that, so this is only a
 * backstop); an admin's change is not spaced (issue #115).
 */
export async function applyDueSuggestions(
  db: Queryable,
  now: Date,
  scope: { householdId?: string } = {},
): Promise<AppliedSuggestion[]> {
  // Chore first, then the suggestion, as `schedule_weight` and
  // `computeSuggestions` lock them, so no two of them can deadlock. The first
  // read takes no lock; each row is claimed again under the chore's lock.
  const candidates = await db
    .select({ id: weightSuggestions.id, choreId: weightSuggestions.choreId })
    .from(weightSuggestions)
    .where(
      and(
        eq(weightSuggestions.status, "scheduled"),
        lte(weightSuggestions.appliesAt, now),
        scope.householdId
          ? eq(weightSuggestions.householdId, scope.householdId)
          : undefined,
      ),
    )
    .orderBy(asc(weightSuggestions.appliesAt), asc(weightSuggestions.id));
  const applied: AppliedSuggestion[] = [];
  for (const candidate of candidates) {
    const [chore] = await db
      .select()
      .from(chores)
      .where(eq(chores.id, candidate.choreId))
      .for("update");
    const [s] = await db
      .select()
      .from(weightSuggestions)
      .where(
        and(
          eq(weightSuggestions.id, candidate.id),
          eq(weightSuggestions.status, "scheduled"),
          lte(weightSuggestions.appliesAt, now),
        ),
      )
      .for("update", { skipLocked: true });
    if (!s) continue;
    if (
      s.origin === "measured" &&
      !changeSpacingOk({
        appliesAt: s.appliesAt!,
        lastAppliedAt: await lastAppliedAt(db, s.choreId),
      })
    ) {
      continue;
    }
    const basePoints = s.scheduledPoints!;
    const cooldownMinutes = s.scheduledCooldownMinutes!;
    const [version] = await db
      .insert(choreRuleVersions)
      .values({
        choreId: s.choreId,
        effectiveFrom: now,
        basePoints,
        cooldownMinutes,
        source: "suggestion",
        suggestionId: s.id,
        createdBy: s.scheduledBy,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [choreRuleVersions.choreId, choreRuleVersions.effectiveFrom],
        set: {
          basePoints,
          cooldownMinutes,
          source: "suggestion",
          suggestionId: s.id,
          createdBy: s.scheduledBy,
        },
      })
      .returning({ id: choreRuleVersions.id });
    await db
      .update(weightSuggestions)
      .set({ status: "applied", appliedAt: now })
      .where(
        and(
          eq(weightSuggestions.id, s.id),
          eq(weightSuggestions.status, "scheduled"),
        ),
      );
    // Only a completion logged up to 2 minutes "in the future" can fall after
    // `now`; re-score so the stored scores stay what a rebuild would make.
    const season = await findSeason(db, chore!.householdId, seasonYear(now));
    if (season) await rescoreLocked(db, chore!, season.id, now);
    applied.push({
      suggestionId: s.id,
      choreId: s.choreId,
      ruleVersionId: version!.id,
      basePoints,
      cooldownMinutes,
    });
  }
  return applied;
}

/** A suggestion of the household by id, without a lock. */
export async function findSuggestion(
  db: Queryable,
  householdId: string,
  suggestionId: string,
): Promise<WeightSuggestionRow | null> {
  const [row] = await db
    .select()
    .from(weightSuggestions)
    .where(
      and(
        eq(weightSuggestions.id, suggestionId),
        eq(weightSuggestions.householdId, householdId),
      ),
    );
  return row ?? null;
}

/**
 * A suggestion of the household by id, row-locked for a decision. A caller
 * that also locks the chore locks it FIRST, as `computeSuggestions` and
 * `applyDueSuggestions` do, so the two can never wait on each other.
 */
export async function lockSuggestion(
  db: Queryable,
  householdId: string,
  suggestionId: string,
): Promise<WeightSuggestionRow | null> {
  const [row] = await db
    .select()
    .from(weightSuggestions)
    .where(
      and(
        eq(weightSuggestions.id, suggestionId),
        eq(weightSuggestions.householdId, householdId),
      ),
    )
    .for("update");
  return row ?? null;
}

/** The rule version in effect for a chore at `now`, or null. */
export async function currentRule(
  db: Queryable,
  choreId: string,
  now: Date,
): Promise<RuleVersion | null> {
  return ruleNow(await loadRuleVersions(db, choreId), now);
}

/**
 * The chore's suggestion waiting on people (open or scheduled), row-locked.
 * Lock the chore first (the order every weight write keeps).
 */
export async function lockActiveSuggestion(
  db: Queryable,
  choreId: string,
): Promise<WeightSuggestionRow | null> {
  const [row] = await db
    .select()
    .from(weightSuggestions)
    .where(
      and(
        eq(weightSuggestions.choreId, choreId),
        inArray(weightSuggestions.status, ["open", "scheduled"]),
      ),
    )
    .for("update");
  return row ?? null;
}

/** Compare-and-set `open` → `superseded`: an admin's change replaces it. */
export async function supersedeSuggestion(
  db: Queryable,
  suggestionId: string,
): Promise<WeightSuggestionRow | null> {
  const [row] = await db
    .update(weightSuggestions)
    .set({ status: "superseded" })
    .where(
      and(
        eq(weightSuggestions.id, suggestionId),
        eq(weightSuggestions.status, "open"),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * An admin's points change (issue #115), stored `scheduled` from the start.
 * The partial unique index keeps it the chore's only open or scheduled one:
 * the caller holds the chore's lock and has superseded an open suggestion.
 */
export async function insertAdminChange(
  db: Queryable,
  input: {
    householdId: string;
    choreId: string;
    currentPoints: number;
    currentCooldownMinutes: number;
    basePoints: number;
    cooldownMinutes: number;
    reason: string | null;
    appliesAt: Date;
    scheduledBy: string;
    now: Date;
  },
): Promise<WeightSuggestionRow> {
  const [row] = await db
    .insert(weightSuggestions)
    .values({
      householdId: input.householdId,
      choreId: input.choreId,
      origin: "admin",
      weekStart: startOfBerlinWeek(input.now),
      computedAt: input.now,
      currentPoints: input.currentPoints,
      currentCooldownMinutes: input.currentCooldownMinutes,
      reason: input.reason,
      status: "scheduled",
      scheduledPoints: input.basePoints,
      scheduledCooldownMinutes: input.cooldownMinutes,
      appliesAt: input.appliesAt,
      scheduledBy: input.scheduledBy,
      scheduledAt: input.now,
    })
    .returning();
  return row!;
}

/** Compare-and-set `open` → `scheduled`. Null if it was no longer open. */
export async function scheduleSuggestion(
  db: Queryable,
  input: {
    suggestionId: string;
    basePoints: number;
    cooldownMinutes: number;
    appliesAt: Date;
    scheduledBy: string;
    now: Date;
  },
): Promise<WeightSuggestionRow | null> {
  const [row] = await db
    .update(weightSuggestions)
    .set({
      status: "scheduled",
      scheduledPoints: input.basePoints,
      scheduledCooldownMinutes: input.cooldownMinutes,
      appliesAt: input.appliesAt,
      scheduledBy: input.scheduledBy,
      scheduledAt: input.now,
    })
    .where(
      and(
        eq(weightSuggestions.id, input.suggestionId),
        eq(weightSuggestions.status, "open"),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Compare-and-set `open`, or `scheduled` before `applies_at`, → `dismissed`.
 * Null if it had moved on.
 */
export async function dismissSuggestion(
  db: Queryable,
  input: { suggestionId: string; dismissedBy: string; now: Date },
): Promise<WeightSuggestionRow | null> {
  const [row] = await db
    .update(weightSuggestions)
    .set({
      status: "dismissed",
      dismissedBy: input.dismissedBy,
      dismissedAt: input.now,
    })
    .where(
      and(
        eq(weightSuggestions.id, input.suggestionId),
        or(
          eq(weightSuggestions.status, "open"),
          and(
            eq(weightSuggestions.status, "scheduled"),
            gt(weightSuggestions.appliesAt, input.now),
          ),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** Compare-and-set `scheduled` before `applies_at` → `vetoed`. */
export async function vetoSuggestion(
  db: Queryable,
  input: { suggestionId: string; vetoedBy: string; now: Date },
): Promise<WeightSuggestionRow | null> {
  const [row] = await db
    .update(weightSuggestions)
    .set({ status: "vetoed", vetoedBy: input.vetoedBy, vetoedAt: input.now })
    .where(
      and(
        eq(weightSuggestions.id, input.suggestionId),
        eq(weightSuggestions.status, "scheduled"),
        gt(weightSuggestions.appliesAt, input.now),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * The suggestions waiting on people (open or scheduled), at most one per
 * chore: the Bounties page's Change points reads these (issue #109).
 */
export async function listActiveSuggestions(
  db: Queryable,
  householdId: string,
): Promise<WeightSuggestionRow[]> {
  return db
    .select()
    .from(weightSuggestions)
    .where(
      and(
        eq(weightSuggestions.householdId, householdId),
        inArray(weightSuggestions.status, ["open", "scheduled"]),
      ),
    );
}

/** One chore's row on the weights panel (`/admin/weights`). */
export interface WeightPanelRow {
  choreId: string;
  choreName: string;
  effortFactorPct: number;
  /** The weight in effect now; null before the chore's first version. */
  rule: { basePoints: number; cooldownMinutes: number } | null;
  /** Measured live at `now`; null without a rule version. */
  live: ChoreMeasurement | null;
  /** The suggestion waiting on people (open or scheduled), if any. */
  active: WeightSuggestionRow | null;
  /** When the chore's last suggestion applied; the next waits 28 days. */
  lastAppliedAt: Date | null;
}

/** Every chore that is not archived, ordered by name, with its weight story. */
export async function listWeightPanel(
  db: Queryable,
  input: { householdId: string; now: Date },
): Promise<WeightPanelRow[]> {
  const rows = await db
    .select()
    .from(chores)
    .where(
      and(eq(chores.householdId, input.householdId), isNull(chores.archivedAt)),
    )
    .orderBy(asc(sql`lower(${chores.name})`), asc(chores.id));
  const active = await listActiveSuggestions(db, input.householdId);
  const activeOf = new Map(active.map((s) => [s.choreId, s]));
  const out: WeightPanelRow[] = [];
  for (const c of rows) {
    const live = await measureChore(db, c, input.now);
    out.push({
      choreId: c.id,
      choreName: c.name,
      effortFactorPct: c.effortFactorPct,
      rule: live
        ? {
            basePoints: live.rule.basePoints,
            cooldownMinutes: live.rule.cooldownMinutes,
          }
        : null,
      live,
      active: activeOf.get(c.id) ?? null,
      lastAppliedAt: await lastAppliedAt(db, c.id),
    });
  }
  return out;
}

/** Scheduled changes of the household not yet applied, soonest first. */
export async function listScheduledChanges(
  db: Queryable,
  householdId: string,
): Promise<(WeightSuggestionRow & { choreName: string })[]> {
  const rows = await db
    .select({ s: weightSuggestions, choreName: chores.name })
    .from(weightSuggestions)
    .innerJoin(chores, eq(chores.id, weightSuggestions.choreId))
    .where(
      and(
        eq(weightSuggestions.householdId, householdId),
        eq(weightSuggestions.status, "scheduled"),
      ),
    )
    .orderBy(asc(weightSuggestions.appliesAt), asc(chores.name));
  return rows.map((r) => ({ ...r.s, choreName: r.choreName }));
}

/** Who a history entry names. */
export interface HistoryMember {
  memberId: string;
  displayName: string;
}

/**
 * What became of a change: `pending` (scheduled, vetoable until
 * `appliesAt`), `landed`, `vetoed` or `cancelled` (by an admin).
 */
export type PointsChangeOutcome = "pending" | "landed" | "vetoed" | "cancelled";

/**
 * One change on a bounty's points history (issue #115). `source` is `seed`
 * (the starting points), `manual` (set at once on the admin chores page or by
 * `update_bounty`), `measured` (the weekly suggestion, scheduled by an admin)
 * or `admin` (points an admin chose, scheduled).
 */
export interface PointsHistoryEntry {
  /** `v:<rule version id>` for a change that landed, else `s:<id>`. */
  key: string;
  choreId: string;
  choreName: string;
  source: "seed" | "manual" | "measured" | "admin";
  /** The scheduled change's id, which a veto or a cancel takes. */
  suggestionId: string | null;
  proposedBy: HistoryMember | null;
  proposedAt: Date;
  /** Null for a bounty's first points. */
  fromPoints: number | null;
  fromCooldownMinutes: number | null;
  toPoints: number;
  toCooldownMinutes: number;
  reason: string | null;
  /** When it lands, landed, or would have landed. */
  appliesAt: Date;
  outcome: PointsChangeOutcome;
  /** Who vetoed or cancelled it, and when. */
  decidedBy: HistoryMember | null;
  decidedAt: Date | null;
}

/**
 * Every change to the household's bounties' points, newest first, or one
 * bounty's with `choreId` (issue #115). Built from `chore_rule_versions`
 * (what landed, and from what) and the scheduled `weight_suggestions` (who
 * proposed it and why, and who vetoed or cancelled it); a suggestion nobody
 * scheduled was never a change, so it is left out. Archived bounties too.
 */
export async function listPointsHistory(
  db: Queryable,
  input: { householdId: string; choreId?: string },
): Promise<PointsHistoryEntry[]> {
  const people = await db
    .select({ memberId: members.id, displayName: members.displayName })
    .from(members)
    .where(eq(members.householdId, input.householdId));
  const who = new Map(people.map((p) => [p.memberId, p]));
  const person = (id: string | null) => (id ? (who.get(id) ?? null) : null);

  const versions = await db
    .select({ v: choreRuleVersions, choreName: chores.name })
    .from(choreRuleVersions)
    .innerJoin(chores, eq(chores.id, choreRuleVersions.choreId))
    .where(
      and(
        eq(chores.householdId, input.householdId),
        input.choreId ? eq(chores.id, input.choreId) : undefined,
      ),
    )
    .orderBy(
      asc(choreRuleVersions.choreId),
      asc(choreRuleVersions.effectiveFrom),
    );
  const scheduled = await db
    .select({ s: weightSuggestions, choreName: chores.name })
    .from(weightSuggestions)
    .innerJoin(chores, eq(chores.id, weightSuggestions.choreId))
    .where(
      and(
        eq(weightSuggestions.householdId, input.householdId),
        input.choreId
          ? eq(weightSuggestions.choreId, input.choreId)
          : undefined,
        isNotNull(weightSuggestions.scheduledAt),
      ),
    );
  const suggestionOf = new Map(scheduled.map((r) => [r.s.id, r.s]));

  const out: PointsHistoryEntry[] = [];
  let previous: (typeof versions)[number]["v"] | null = null;
  for (const { v, choreName } of versions) {
    const from = previous?.choreId === v.choreId ? previous : null;
    previous = v;
    const s = v.suggestionId ? suggestionOf.get(v.suggestionId) : undefined;
    out.push({
      key: `v:${v.id}`,
      choreId: v.choreId,
      choreName,
      source: s ? s.origin : v.source === "seed" ? "seed" : "manual",
      suggestionId: s?.id ?? null,
      proposedBy: person(s ? s.scheduledBy : v.createdBy),
      proposedAt: s ? s.scheduledAt! : v.createdAt,
      fromPoints: from?.basePoints ?? null,
      fromCooldownMinutes: from?.cooldownMinutes ?? null,
      toPoints: v.basePoints,
      toCooldownMinutes: v.cooldownMinutes,
      reason: s?.reason ?? null,
      appliesAt: v.effectiveFrom,
      outcome: "landed",
      decidedBy: null,
      decidedAt: null,
    });
  }
  for (const { s, choreName } of scheduled) {
    if (s.status === "applied") continue; // listed with its rule version
    out.push({
      key: `s:${s.id}`,
      choreId: s.choreId,
      choreName,
      source: s.origin,
      suggestionId: s.id,
      proposedBy: person(s.scheduledBy),
      proposedAt: s.scheduledAt!,
      fromPoints: s.currentPoints,
      fromCooldownMinutes: s.currentCooldownMinutes,
      toPoints: s.scheduledPoints!,
      toCooldownMinutes: s.scheduledCooldownMinutes!,
      reason: s.reason,
      appliesAt: s.appliesAt!,
      outcome:
        s.status === "vetoed"
          ? "vetoed"
          : s.status === "dismissed"
            ? "cancelled"
            : "pending",
      decidedBy: person(s.vetoedBy ?? s.dismissedBy),
      decidedAt: s.vetoedAt ?? s.dismissedAt,
    });
  }
  return out.sort(
    (a, b) =>
      b.proposedAt.getTime() - a.proposedAt.getTime() ||
      b.appliesAt.getTime() - a.appliesAt.getTime() ||
      a.key.localeCompare(b.key),
  );
}
