import {
  challengeWindowEndsAt,
  effectiveStatus,
  type CompletionStatus,
  type DisputeResolution,
  type VerificationRow,
  type VoidReason,
} from "@baumy/core";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { toVerificationRow } from "./confirmations";
import type { Queryable } from "./index";
import {
  auditEvents,
  chores,
  completionScores,
  completions,
  disputes,
  members,
  weightSuggestions,
} from "./schema";

// The activity log (issue #150, SPEC §4.3): what happened in the house,
// newest first. Owner: "What you're describing is an activity log, which is
// cool, but it's not an inbox, that is for messages."
//
// Four kinds of entry, each read from where it is already kept:
// - `chore`: a completion logged (`completions`), with its status at `now`;
// - `dispute`: a dispute raised (`disputes`), with how it ended, if it has;
// - `bounty`: a bounty added or edited (the `audit_events` rows of
//   `create_bounty`, `update_bounty` and `manage_chore`'s create and update);
// - `points`: a points change scheduled, applied or vetoed
//   (`weight_suggestions`).
//
// Statuses are `effectiveStatus` at `now`, so a claim that finalized or timed
// out shows so before the daily job writes it. Read only.

/** Who an entry names. */
export interface ActivityMember {
  memberId: string;
  displayName: string;
}

/** A completion logged. */
export interface ActivityChore {
  kind: "chore";
  at: Date;
  completionId: string;
  choreId: string;
  choreName: string;
  doneBy: ActivityMember;
  loggedBy: ActivityMember;
  occurredAt: Date;
  /** `effectiveStatus` at `now`. */
  status: CompletionStatus;
  /** Why it was voided, once it is (a timed-out dispute is `disputed`). */
  voidReason: VoidReason | null;
  /** Disputes are possible until then. */
  windowEndsAt: Date;
  /** The pathname in Blob; callers show it only through /api/blob. */
  photoPathname: string | null;
  /** The dispute open on it at `now`. */
  dispute: { raisedBy: ActivityMember; reason: string } | null;
  /** Its points while it counts; null otherwise. */
  totalPts: number | null;
  /** The shape `claimAbilities` reads. */
  row: VerificationRow;
}

/** A dispute raised, and how it ended. */
export interface ActivityDispute {
  kind: "dispute";
  at: Date;
  disputeId: string;
  completionId: string;
  choreName: string;
  doneBy: ActivityMember;
  raisedBy: ActivityMember;
  reason: string;
  /**
   * How it ended, or null while it is open. A dispute whose window ran out
   * with no photo is `expired` at `now`, whether or not the daily job has
   * written that yet.
   */
  resolution: DisputeResolution | null;
  resolvedAt: Date | null;
}

/** A bounty added or edited. */
export interface ActivityBounty {
  kind: "bounty";
  at: Date;
  auditId: number;
  choreId: string;
  /** Its name now. */
  choreName: string;
  change: "added" | "edited";
  by: ActivityMember | null;
}

/** A points change scheduled, applied or vetoed. */
export interface ActivityPoints {
  kind: "points";
  at: Date;
  suggestionId: string;
  choreId: string;
  choreName: string;
  event: "scheduled" | "applied" | "vetoed";
  /** Who scheduled it, or vetoed it; null for `applied`. */
  by: ActivityMember | null;
  scheduledBy: string | null;
  fromPoints: number;
  toPoints: number;
  fromCooldownMinutes: number;
  toCooldownMinutes: number;
  appliesAt: Date;
  reason: string | null;
  /** Still scheduled at `now`, so another member may veto it. */
  vetoable: boolean;
}

export type ActivityEntry =
  ActivityChore | ActivityDispute | ActivityBounty | ActivityPoints;

/** The audit rows that add or edit a bounty. */
const BOUNTY_ACTIONS = ["create_bounty", "update_bounty"];

/** A stable order for entries at the same moment. */
function entryKey(e: ActivityEntry): string {
  switch (e.kind) {
    case "chore":
      return `c:${e.completionId}`;
    case "dispute":
      return `d:${e.disputeId}`;
    case "bounty":
      return `b:${String(e.auditId).padStart(12, "0")}`;
    case "points":
      return `p:${e.suggestionId}:${e.event}`;
  }
}

/**
 * The household's activity from `since` up to `now`, newest first, at most
 * `limit` entries.
 */
export async function listActivity(
  db: Queryable,
  input: { householdId: string; since: Date; now: Date; limit: number },
): Promise<ActivityEntry[]> {
  const { householdId, since, now, limit } = input;
  const people = await db
    .select({ memberId: members.id, displayName: members.displayName })
    .from(members)
    .where(eq(members.householdId, householdId));
  const who = new Map(people.map((p) => [p.memberId, p]));
  const person = (id: string): ActivityMember =>
    who.get(id) ?? { memberId: id, displayName: "Someone" };
  const maybe = (id: string | null) => (id ? person(id) : null);
  const window = (col: Parameters<typeof gte>[0]) =>
    and(gte(col, since), lte(col, now));

  const [claimRows, disputeRows, bountyRows, pointRows] = await Promise.all([
    db
      .select({
        completion: completions,
        choreName: chores.name,
        totalPts: completionScores.totalPts,
      })
      .from(completions)
      .innerJoin(chores, eq(chores.id, completions.choreId))
      .leftJoin(
        completionScores,
        eq(completionScores.completionId, completions.id),
      )
      .where(
        and(
          eq(completions.householdId, householdId),
          window(completions.loggedAt),
        ),
      )
      .orderBy(desc(completions.loggedAt), desc(completions.id))
      .limit(limit),
    db
      .select({
        dispute: disputes,
        completion: completions,
        choreName: chores.name,
      })
      .from(disputes)
      .innerJoin(completions, eq(completions.id, disputes.completionId))
      .innerJoin(chores, eq(chores.id, completions.choreId))
      .where(
        and(
          eq(completions.householdId, householdId),
          window(disputes.createdAt),
        ),
      )
      .orderBy(desc(disputes.createdAt), desc(disputes.id))
      .limit(limit),
    db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        op: sql<string | null>`${auditEvents.payload}->>'op'`,
        actor: auditEvents.actorMemberId,
        at: auditEvents.at,
        choreId: chores.id,
        choreName: chores.name,
      })
      .from(auditEvents)
      // The household is the chore's: audit rows carry no household.
      .innerJoin(chores, sql`${chores.id}::text = ${auditEvents.entityId}`)
      .where(
        and(
          eq(auditEvents.entity, "chore"),
          eq(chores.householdId, householdId),
          or(
            inArray(auditEvents.action, BOUNTY_ACTIONS),
            and(
              eq(auditEvents.action, "manage_chore"),
              sql`${auditEvents.payload}->>'op' in ('create', 'update')`,
            ),
          ),
          window(auditEvents.at),
        ),
      )
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(limit),
    db
      .select({ s: weightSuggestions, choreName: chores.name })
      .from(weightSuggestions)
      .innerJoin(chores, eq(chores.id, weightSuggestions.choreId))
      .where(
        and(
          eq(weightSuggestions.householdId, householdId),
          isNotNull(weightSuggestions.scheduledAt),
          or(
            window(weightSuggestions.scheduledAt),
            window(weightSuggestions.vetoedAt),
            window(weightSuggestions.appliesAt),
          ),
        ),
      ),
  ]);

  // The disputes still open on the listed claims, for their entries.
  const claimIds = claimRows.map((r) => r.completion.id);
  const open = claimIds.length
    ? await db
        .select()
        .from(disputes)
        .where(
          and(
            isNull(disputes.resolvedAt),
            inArray(disputes.completionId, claimIds),
          ),
        )
    : [];
  const openOf = new Map(open.map((d) => [d.completionId, d]));

  const out: ActivityEntry[] = [];
  for (const r of claimRows) {
    const c = r.completion;
    const d = openOf.get(c.id) ?? null;
    const row = toVerificationRow(c, d?.raisedBy ?? null);
    const status = effectiveStatus(row, now);
    out.push({
      kind: "chore",
      at: c.loggedAt,
      completionId: c.id,
      choreId: c.choreId,
      choreName: r.choreName,
      doneBy: person(c.doneBy),
      loggedBy: person(c.loggedBy),
      occurredAt: c.occurredAt,
      status,
      voidReason: status === "voided" ? (c.voidReason ?? "disputed") : null,
      windowEndsAt: challengeWindowEndsAt(row),
      photoPathname: c.photoPathname,
      dispute:
        status === "disputed" && d
          ? { raisedBy: person(d.raisedBy), reason: d.reason }
          : null,
      totalPts:
        status === "disputed" || status === "voided" ? null : r.totalPts,
      row,
    });
  }

  for (const r of disputeRows) {
    const d = r.dispute;
    // An open dispute on a claim that timed out has expired at `now`.
    const expired =
      d.resolvedAt === null &&
      effectiveStatus(toVerificationRow(r.completion, d.raisedBy), now) ===
        "voided";
    out.push({
      kind: "dispute",
      at: d.createdAt,
      disputeId: d.id,
      completionId: d.completionId,
      choreName: r.choreName,
      doneBy: person(r.completion.doneBy),
      raisedBy: person(d.raisedBy),
      reason: d.reason,
      resolution: expired ? "expired" : d.resolution,
      resolvedAt: expired
        ? challengeWindowEndsAt(toVerificationRow(r.completion, d.raisedBy))
        : d.resolvedAt,
    });
  }

  for (const b of bountyRows) {
    out.push({
      kind: "bounty",
      at: b.at,
      auditId: b.id,
      choreId: b.choreId,
      choreName: b.choreName,
      change:
        b.action === "create_bounty" || b.op === "create" ? "added" : "edited",
      by: maybe(b.actor),
    });
  }

  for (const { s, choreName } of pointRows) {
    const base = {
      kind: "points" as const,
      suggestionId: s.id,
      choreId: s.choreId,
      choreName,
      scheduledBy: s.scheduledBy,
      fromPoints: s.currentPoints,
      toPoints: s.scheduledPoints!,
      fromCooldownMinutes: s.currentCooldownMinutes,
      toCooldownMinutes: s.scheduledCooldownMinutes!,
      appliesAt: s.appliesAt!,
      reason: s.reason,
      vetoable:
        s.status === "scheduled" && s.appliesAt!.getTime() > now.getTime(),
    };
    const inWindow = (t: Date | null): t is Date =>
      t !== null &&
      t.getTime() >= since.getTime() &&
      t.getTime() <= now.getTime();
    if (inWindow(s.scheduledAt)) {
      out.push({
        ...base,
        at: s.scheduledAt,
        event: "scheduled",
        by: maybe(s.scheduledBy),
      });
    }
    // A change lands at `applies_at`, whether or not the daily job has
    // applied it yet.
    if (
      (s.status === "applied" || s.status === "scheduled") &&
      inWindow(s.appliesAt)
    ) {
      out.push({ ...base, at: s.appliesAt, event: "applied", by: null });
    }
    if (s.status === "vetoed" && inWindow(s.vetoedAt)) {
      out.push({
        ...base,
        at: s.vetoedAt,
        event: "vetoed",
        by: maybe(s.vetoedBy),
      });
    }
  }

  return out
    .sort(
      (a, b) =>
        b.at.getTime() - a.at.getTime() ||
        entryKey(b).localeCompare(entryKey(a)),
    )
    .slice(0, limit);
}
