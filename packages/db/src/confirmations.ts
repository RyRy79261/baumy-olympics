import {
  challengeWindowEndsAt,
  effectiveStatus,
  partnerExpiresAt,
  transition,
  type CompletionStatus,
  type ConfirmMode,
  type DisputeResolution,
  type ProofMode,
  type TransitionErrorCode,
  type VerificationEvent,
  type VerificationRow,
} from "@baumy/core";
import { aliasedTable, and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { lockChoreRow, type ChoreRow } from "./chores";
import { rescoreLocked, type CompletionRow } from "./completions";
import type { Queryable } from "./index";
import {
  chores,
  completionScores,
  completions,
  disputes,
  members,
} from "./schema";

// The honesty layer's writes and reads (SPEC §4.3): confirm, dispute,
// withdraw, concede, undo and resolve, attaching a proof photo, and the open
// claims a member may act on.
//
// Every write follows the completion write path (AGENTS.md "Completion
// writes"): lock the chore row, read the completion afresh under the lock,
// judge the event with `transition` (packages/core) at `now`, compare-and-set
// the stored status, keep `disputes` in step, and re-score the
// (chore, season), all in the caller's transaction. Nothing here writes
// `audit_events` or `action_requests`; runAction does.

export type OpenDispute = typeof disputes.$inferSelect;

/** A completion with what its verification depends on. */
export interface CompletionForVerification {
  completion: CompletionRow;
  chore: {
    id: string;
    name: string;
    confirmMode: ConfirmMode;
    proofMode: ProofMode;
  };
  /** The dispute still open on it, if any. */
  dispute: OpenDispute | null;
  /** The shape `transition` and `effectiveStatus` read. */
  row: VerificationRow;
}

function toVerificationRow(
  c: CompletionRow,
  confirmMode: ConfirmMode,
  raisedBy: string | null,
): VerificationRow {
  return {
    status: c.status,
    confirmMode,
    doneBy: c.doneBy,
    loggedBy: c.loggedBy,
    loggedAt: c.loggedAt,
    finalizesAt: c.finalizesAt,
    photoAttachedAt: c.photoAttachedAt,
    // Only a `disputed` row has a disputer; a dispute left open on a row the
    // daily job has not settled yet does not make it one.
    disputedBy: c.status === "disputed" ? raisedBy : null,
    verifiedBy: c.verifiedBy,
    verifiedAt: c.verifiedAt,
    voidReason: c.voidReason,
  };
}

/** The completion, its chore and its open dispute, or null. */
export async function loadForVerification(
  db: Queryable,
  householdId: string,
  completionId: string,
): Promise<CompletionForVerification | null> {
  const [found] = await db
    .select({
      completion: completions,
      chore: {
        id: chores.id,
        name: chores.name,
        confirmMode: chores.confirmMode,
        proofMode: chores.proofMode,
      },
    })
    .from(completions)
    .innerJoin(chores, eq(chores.id, completions.choreId))
    .where(
      and(
        eq(completions.id, completionId),
        eq(completions.householdId, householdId),
      ),
    )
    .limit(1);
  if (!found) return null;
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(
      and(eq(disputes.completionId, completionId), isNull(disputes.resolvedAt)),
    )
    .limit(1);
  return {
    completion: found.completion,
    chore: found.chore,
    dispute: dispute ?? null,
    row: toVerificationRow(
      found.completion,
      found.chore.confirmMode,
      dispute?.raisedBy ?? null,
    ),
  };
}

/**
 * Find the completion's chore and lock it, then read the completion again
 * under the lock, so the event is judged on what no one else can change
 * before this transaction ends.
 */
async function lockAndLoad(
  db: Queryable,
  householdId: string,
  completionId: string,
): Promise<{
  loaded: CompletionForVerification;
  lockedChore: ChoreRow;
} | null> {
  const [target] = await db
    .select({ choreId: completions.choreId })
    .from(completions)
    .where(
      and(
        eq(completions.id, completionId),
        eq(completions.householdId, householdId),
      ),
    )
    .limit(1);
  if (!target) return null;
  const lockedChore = await lockChoreRow(db, householdId, target.choreId);
  if (!lockedChore) return null;
  const loaded = await loadForVerification(db, householdId, completionId);
  return loaded ? { loaded, lockedChore } : null;
}

export type CompletionEventFailure =
  | { ok: false; code: TransitionErrorCode }
  | { ok: false; code: "NOT_FOUND" }
  /** The stored status moved between the read and the write. */
  | { ok: false; code: "STALE" };

export type CompletionEventResult =
  | {
      ok: true;
      completion: CompletionRow;
      choreName: string;
      /** The status before the event, as it was at `now`. */
      previousStatus: CompletionStatus;
      /** How the open dispute ended, when the event ended it. */
      disputeResolution: DisputeResolution | null;
    }
  | CompletionEventFailure;

/**
 * Apply a verification event (SPEC §4.3) to a completion at `now`: confirm,
 * dispute, withdraw, concede, undo or an admin's ruling. The row is judged by
 * `transition` at `now`, written with a compare-and-set on its stored status,
 * the dispute row is opened or closed with it, and the (chore, season) is
 * re-scored, since the counted set may have changed.
 */
export async function applyCompletionEvent(
  db: Queryable,
  input: {
    householdId: string;
    completionId: string;
    event: VerificationEvent;
    now: Date;
  },
): Promise<CompletionEventResult> {
  const locked = await lockAndLoad(db, input.householdId, input.completionId);
  if (!locked) return { ok: false, code: "NOT_FOUND" };
  const { loaded, lockedChore } = locked;
  const previousStatus = effectiveStatus(loaded.row, input.now);
  const verdict = transition(loaded.row, input.event, input.now);
  if (!verdict.ok) return verdict;

  const next = verdict.row;
  const [updated] = await db
    .update(completions)
    .set({
      status: next.status,
      voidReason: next.voidReason,
      verifiedBy: next.verifiedBy,
      verifiedAt: next.verifiedAt,
      finalizesAt: next.finalizesAt,
    })
    .where(
      and(
        eq(completions.id, input.completionId),
        eq(completions.status, verdict.expectedStatus),
      ),
    )
    .returning();
  if (!updated) return { ok: false, code: "STALE" };

  if (input.event.type === "dispute") {
    await db.insert(disputes).values({
      completionId: input.completionId,
      raisedBy: input.event.actor,
      reason: input.event.reason.trim(),
      createdAt: input.now,
    });
  }
  // Every event that leaves `disputed` names how the dispute ended.
  if (verdict.disputeResolution !== null) {
    await db
      .update(disputes)
      .set({ resolution: verdict.disputeResolution, resolvedAt: input.now })
      .where(
        and(
          eq(disputes.completionId, input.completionId),
          isNull(disputes.resolvedAt),
        ),
      );
  }

  await rescoreLocked(db, lockedChore, updated.seasonId, input.now);
  return {
    ok: true,
    completion: updated,
    choreName: loaded.chore.name,
    previousStatus,
    disputeResolution: verdict.disputeResolution,
  };
}

export type AttachPhotoResult =
  | { ok: true; completion: CompletionRow; choreName: string }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" }
  /** A photo is already there; proof is kept, not replaced. */
  | { ok: false; code: "PHOTO_ALREADY_ATTACHED" }
  | { ok: false; code: "STALE" };

/**
 * Attach a proof photo, already stored in Blob at `pathname`, to a completion
 * (SPEC §4.3, §6.5). Only its doer or its logger may, and only while it is not
 * voided at `now`. Only the first attach time counts against a dispute's
 * timeout, and a photo, once attached, is not replaced. Scores do not change:
 * a photo never changes the counted set.
 */
export async function attachCompletionPhoto(
  db: Queryable,
  input: {
    householdId: string;
    completionId: string;
    actorId: string;
    pathname: string;
    now: Date;
  },
): Promise<AttachPhotoResult> {
  const locked = await lockAndLoad(db, input.householdId, input.completionId);
  if (!locked) return { ok: false, code: "NOT_FOUND" };
  const { loaded } = locked;
  const c = loaded.completion;
  if (input.actorId !== c.doneBy && input.actorId !== c.loggedBy) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (effectiveStatus(loaded.row, input.now) === "voided") {
    return { ok: false, code: "INVALID_STATE" };
  }
  if (c.photoPathname !== null) {
    return { ok: false, code: "PHOTO_ALREADY_ATTACHED" };
  }
  const [updated] = await db
    .update(completions)
    .set({
      photoPathname: input.pathname,
      photoAttachedAt: c.photoAttachedAt ?? input.now,
    })
    .where(and(eq(completions.id, c.id), isNull(completions.photoPathname)))
    .returning();
  if (!updated) return { ok: false, code: "STALE" };
  return { ok: true, completion: updated, choreName: loaded.chore.name };
}

/** Which events a member may apply to a claim right now. */
export interface ClaimAbilities {
  confirm: boolean;
  dispute: boolean;
  withdraw: boolean;
  concede: boolean;
  undo: boolean;
  /** Admins only, never on their own claim. */
  resolve: boolean;
  attachPhoto: boolean;
}

/**
 * What `memberId` may do to the row at `now`, each judged by the same
 * `transition` the write uses, so the buttons shown are exactly the events
 * that would succeed.
 */
export function claimAbilities(
  row: VerificationRow,
  hasPhoto: boolean,
  memberId: string,
  isAdmin: boolean,
  now: Date,
): ClaimAbilities {
  const can = (event: VerificationEvent) => transition(row, event, now).ok;
  const status = effectiveStatus(row, now);
  return {
    confirm: can({ type: "confirm", actor: memberId }),
    dispute: can({ type: "dispute", actor: memberId, reason: "?" }),
    withdraw: can({ type: "withdraw", actor: memberId }),
    concede: can({ type: "concede", actor: memberId }),
    undo: can({ type: "undo", actor: memberId }),
    resolve:
      isAdmin &&
      can({
        type: "resolve",
        actor: memberId,
        actorIsAdmin: true,
        outcome: "uphold",
      }),
    attachPhoto:
      !hasPhoto &&
      status !== "voided" &&
      (memberId === row.doneBy || memberId === row.loggedBy),
  };
}

/** An open claim (pending or disputed at `now`), as the inbox shows it. */
export interface OpenClaim {
  completionId: string;
  choreId: string;
  choreName: string;
  confirmMode: ConfirmMode;
  doneBy: string;
  doneByName: string;
  loggedBy: string;
  loggedByName: string;
  occurredAt: Date;
  loggedAt: Date;
  /** `effectiveStatus` at `now`: `pending` or `disputed`. */
  status: "pending" | "disputed";
  /** When the challenge window ends (disputes close then). */
  windowEndsAt: Date;
  /** Optimistic pending: when it finalizes by itself. */
  finalizesAt: Date | null;
  /** Partner mode: when it is voided if nobody confirms it. */
  expiresAt: Date | null;
  /** The pathname in Blob; callers show it only through /api/blob. */
  photoPathname: string | null;
  photoAttachedAt: Date | null;
  dispute: {
    raisedBy: string;
    raisedByName: string;
    reason: string;
    raisedAt: Date;
  } | null;
  /** The stored score while it counts; null otherwise. */
  totalPts: number | null;
  row: VerificationRow;
}

/**
 * Every claim of the household that is still open at `now`: stored as
 * `pending` or `disputed`, and still so by `effectiveStatus` (a claim that
 * finalized, expired or timed out is not open, whether or not the daily job
 * has written that yet). Oldest first.
 */
export async function listOpenClaims(
  db: Queryable,
  input: { householdId: string; now: Date },
): Promise<OpenClaim[]> {
  const doer = aliasedTable(members, "doer");
  const logger = aliasedTable(members, "logger");
  const rows = await db
    .select({
      completion: completions,
      choreName: chores.name,
      confirmMode: chores.confirmMode,
      doneByName: doer.displayName,
      loggedByName: logger.displayName,
      totalPts: completionScores.totalPts,
    })
    .from(completions)
    .innerJoin(chores, eq(chores.id, completions.choreId))
    .innerJoin(doer, eq(doer.id, completions.doneBy))
    .innerJoin(logger, eq(logger.id, completions.loggedBy))
    .leftJoin(
      completionScores,
      eq(completionScores.completionId, completions.id),
    )
    .where(
      and(
        eq(completions.householdId, input.householdId),
        inArray(completions.status, ["pending", "disputed"]),
      ),
    )
    .orderBy(completions.loggedAt, completions.id);
  if (rows.length === 0) return [];

  const disputer = aliasedTable(members, "disputer");
  const open = await db
    .select({
      completionId: disputes.completionId,
      raisedBy: disputes.raisedBy,
      raisedByName: disputer.displayName,
      reason: disputes.reason,
      raisedAt: disputes.createdAt,
    })
    .from(disputes)
    .innerJoin(disputer, eq(disputer.id, disputes.raisedBy))
    .where(
      and(
        isNull(disputes.resolvedAt),
        inArray(
          disputes.completionId,
          rows.map((r) => r.completion.id),
        ),
      ),
    );
  const disputeOf = new Map(open.map((d) => [d.completionId, d]));

  const claims: OpenClaim[] = [];
  for (const r of rows) {
    const c = r.completion;
    const d = disputeOf.get(c.id) ?? null;
    const row = toVerificationRow(c, r.confirmMode, d?.raisedBy ?? null);
    const status = effectiveStatus(row, input.now);
    if (status !== "pending" && status !== "disputed") continue;
    claims.push({
      completionId: c.id,
      choreId: c.choreId,
      choreName: r.choreName,
      confirmMode: r.confirmMode,
      doneBy: c.doneBy,
      doneByName: r.doneByName,
      loggedBy: c.loggedBy,
      loggedByName: r.loggedByName,
      occurredAt: c.occurredAt,
      loggedAt: c.loggedAt,
      status,
      windowEndsAt: challengeWindowEndsAt(row),
      finalizesAt: c.finalizesAt,
      expiresAt: r.confirmMode === "partner" ? partnerExpiresAt(row) : null,
      photoPathname: c.photoPathname,
      photoAttachedAt: c.photoAttachedAt,
      dispute: d
        ? {
            raisedBy: d.raisedBy,
            raisedByName: d.raisedByName,
            reason: d.reason,
            raisedAt: d.raisedAt,
          }
        : null,
      totalPts: r.totalPts,
      row,
    });
  }
  return claims;
}

/** A member's own claim that has settled, with how. */
export interface SettledClaim {
  completionId: string;
  choreName: string;
  loggedAt: Date;
  /** `effectiveStatus` at `now`: finalized, confirmed or voided. */
  status: Exclude<CompletionStatus, "pending" | "disputed">;
  voidReason: CompletionRow["voidReason"];
  totalPts: number | null;
}

/**
 * The member's own claims (as doer) logged since `since` that are no longer
 * open at `now`, newest first. The status is `effectiveStatus`, so a claim
 * that finalized an hour ago shows as finalized before the daily job runs.
 */
export async function listSettledClaims(
  db: Queryable,
  input: {
    householdId: string;
    memberId: string;
    since: Date;
    now: Date;
    limit: number;
  },
): Promise<SettledClaim[]> {
  const rows = await db
    .select({
      completion: completions,
      choreName: chores.name,
      confirmMode: chores.confirmMode,
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
        eq(completions.householdId, input.householdId),
        eq(completions.doneBy, input.memberId),
        gte(completions.loggedAt, input.since),
      ),
    )
    .orderBy(desc(completions.loggedAt), desc(completions.id));
  const out: SettledClaim[] = [];
  for (const r of rows) {
    const c = r.completion;
    const row = toVerificationRow(c, r.confirmMode, null);
    const status = effectiveStatus(row, input.now);
    if (status === "pending" || status === "disputed") continue;
    out.push({
      completionId: c.id,
      choreName: r.choreName,
      loggedAt: c.loggedAt,
      status,
      voidReason:
        status === "voided"
          ? (c.voidReason ??
            (c.status === "disputed" ? "disputed" : "unconfirmed"))
          : null,
      totalPts: status === "voided" ? null : r.totalPts,
    });
    if (out.length >= input.limit) break;
  }
  return out;
}

/** The completion a Blob pathname belongs to, if it is in the household. */
export async function completionInHousehold(
  db: Queryable,
  householdId: string,
  completionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: completions.id })
    .from(completions)
    .where(
      and(
        eq(completions.id, completionId),
        eq(completions.householdId, householdId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
