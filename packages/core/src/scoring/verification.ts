// SPEC §4.3: the verification state machine of a completion. Pure: the caller
// passes `now`, and every event is checked against the status the row has at
// `now` (`effectiveStatus`), never against the stored one alone.
//
// Two kinds of transition exist:
// - events (dispute, withdraw, concede, undo, resolve), which the caller
//   persists as a compare-and-set on `expectedStatus`;
// - time-derived ones (⏱ in the SPEC table), which are computed on read and
//   only persisted by the daily job (`settle`). None of them changes the
//   counted set (`isCounted` in replay.ts), so stored scores never go stale.
//
// There is no confirming (SPEC §12 decision 29): a self-claim counts at once
// and settles when its challenge window ends, unless someone disputes it.
import { RULESET_V1, type CompletionStatus, type Ruleset } from "./ruleset";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Why a completion was voided (`completions.void_reason`). `unconfirmed` is
 * history only: a claim of the removed partner mode that nobody confirmed.
 */
export type VoidReason = "unconfirmed" | "conceded" | "disputed" | "undone";

/** How an open dispute ended (`disputes.resolution`). */
export type DisputeResolution =
  "withdrawn" | "conceded" | "undone" | "upheld" | "overruled" | "expired";

/** The columns of a completion that decide its verification status. */
export interface VerificationRow {
  status: CompletionStatus;
  doneBy: string;
  loggedBy: string;
  loggedAt: Date;
  /** Self-claims only: when `pending` becomes `finalized`. */
  finalizesAt: Date | null;
  /** When the first proof photo was attached, if any. */
  photoAttachedAt: Date | null;
  /** The member who raised the open dispute, while `disputed`. */
  disputedBy: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  voidReason: VoidReason | null;
}

/** The fields `effectiveStatus` reads. */
export type TimedRow = Pick<
  VerificationRow,
  "status" | "loggedAt" | "finalizesAt" | "photoAttachedAt"
>;

export interface NewClaim {
  doneBy: string;
  loggedBy: string;
  loggedAt: Date;
  photoAttachedAt?: Date | null;
}

/**
 * The row a new completion starts as. Logged for someone else, it is verified
 * on creation. A self-claim is `pending`, counts at once and finalizes at
 * `logged_at + 24h` unless it is disputed.
 */
export function initialVerification(
  claim: NewClaim,
  ruleset: Ruleset = RULESET_V1,
): VerificationRow {
  const base = {
    doneBy: claim.doneBy,
    loggedBy: claim.loggedBy,
    loggedAt: claim.loggedAt,
    photoAttachedAt: claim.photoAttachedAt ?? null,
    disputedBy: null,
    voidReason: null,
  };
  if (claim.loggedBy !== claim.doneBy) {
    return {
      ...base,
      status: "confirmed",
      finalizesAt: null,
      verifiedBy: claim.loggedBy,
      verifiedAt: claim.loggedAt,
    };
  }
  return {
    ...base,
    status: "pending",
    finalizesAt: new Date(
      claim.loggedAt.getTime() + ruleset.challengeWindowH * HOUR,
    ),
    verifiedBy: null,
    verifiedAt: null,
  };
}

/**
 * When the challenge window closes: `finalizes_at` for a self-claim (moved
 * later by a withdrawn dispute), `logged_at + 24h` otherwise.
 */
export function challengeWindowEndsAt(
  row: Pick<TimedRow, "loggedAt" | "finalizesAt">,
  ruleset: Ruleset = RULESET_V1,
): Date {
  return (
    row.finalizesAt ??
    new Date(row.loggedAt.getTime() + ruleset.challengeWindowH * HOUR)
  );
}

/**
 * The time-derived transition due at `now`, if any. A photo counts against a
 * dispute's timeout only if it was attached before the window ended.
 */
function timeDerived(
  row: TimedRow,
  now: Date,
  ruleset: Ruleset,
): { status: CompletionStatus; voidReason: VoidReason | null } | null {
  const t = now.getTime();
  if (row.status === "pending") {
    return row.finalizesAt !== null && t >= row.finalizesAt.getTime()
      ? { status: "finalized", voidReason: null }
      : null;
  }
  if (row.status === "disputed") {
    const ends = challengeWindowEndsAt(row, ruleset).getTime();
    const photoInTime =
      row.photoAttachedAt !== null && row.photoAttachedAt.getTime() < ends;
    return t >= ends && !photoInTime
      ? { status: "voided", voidReason: "disputed" }
      : null;
  }
  return null;
}

/** The status the row has at `now`, with every ⏱ transition applied. */
export function effectiveStatus(
  row: TimedRow,
  now: Date,
  ruleset: Ruleset = RULESET_V1,
): CompletionStatus {
  return timeDerived(row, now, ruleset)?.status ?? row.status;
}

/**
 * The row with every time-derived transition due at `now` persisted, as the
 * daily job writes it. Returns the same row when nothing is due. When a
 * `disputed` row settles to `voided`, the caller closes its dispute as
 * `expired`.
 */
export function settle(
  row: VerificationRow,
  now: Date,
  ruleset: Ruleset = RULESET_V1,
): VerificationRow {
  const next = timeDerived(row, now, ruleset);
  if (next === null) return row;
  return {
    ...row,
    status: next.status,
    voidReason: next.voidReason,
    disputedBy: null,
  };
}

/** Record a proof photo. Only the first attach time matters. */
export function attachPhoto(row: VerificationRow, now: Date): VerificationRow {
  return row.photoAttachedAt === null ? { ...row, photoAttachedAt: now } : row;
}

export type VerificationEvent =
  | { type: "dispute"; actor: string; reason: string }
  | { type: "withdraw"; actor: string }
  | { type: "concede"; actor: string }
  | { type: "undo"; actor: string }
  | {
      type: "resolve";
      actor: string;
      actorIsAdmin: boolean;
      outcome: "uphold" | "void";
    };

/**
 * - `INVALID_STATE`: at `now`, the row is not in a status the event applies
 *   to (time may have moved it on: finalized or timed out).
 * - `WINDOW_CLOSED`: the challenge window (dispute) or the undo window has
 *   passed.
 * - `FORBIDDEN`: this member may not do this to this row.
 * - `REASON_REQUIRED`: a dispute needs a reason.
 */
export type TransitionErrorCode =
  "INVALID_STATE" | "WINDOW_CLOSED" | "FORBIDDEN" | "REASON_REQUIRED";

export type TransitionResult =
  | {
      ok: true;
      /** Compare-and-set the write on this stored status. */
      expectedStatus: CompletionStatus;
      row: VerificationRow;
      /** Set when the event closes the open dispute. */
      disputeResolution: DisputeResolution | null;
    }
  | { ok: false; code: TransitionErrorCode };

/** The statuses each event applies to (at `now`). */
const FROM: Record<VerificationEvent["type"], readonly CompletionStatus[]> = {
  dispute: ["pending"],
  withdraw: ["disputed"],
  concede: ["disputed"],
  undo: ["pending", "disputed"],
  resolve: ["disputed"],
};

function fail(code: TransitionErrorCode): TransitionResult {
  return { ok: false, code };
}

/**
 * Apply an event to a completion at `now` (SPEC §4.3 transition table). The
 * checks run in the order state, actor, window, reason, and the first failure
 * is returned.
 */
export function transition(
  row: VerificationRow,
  event: VerificationEvent,
  now: Date,
  ruleset: Ruleset = RULESET_V1,
): TransitionResult {
  const from = FROM[event.type];
  const status = effectiveStatus(row, now, ruleset);
  // Judged on the status at `now` alone, so an event's outcome is the same
  // whether or not the daily job has persisted the time-derived transitions.
  if (!from.includes(status)) return fail("INVALID_STATE");
  const t = now.getTime();
  const ok = (
    next: Partial<VerificationRow>,
    disputeResolution: DisputeResolution | null = null,
  ): TransitionResult => ({
    ok: true,
    expectedStatus: row.status,
    row: { ...row, ...next },
    disputeResolution,
  });

  switch (event.type) {
    case "dispute":
      if (event.actor === row.doneBy) return fail("FORBIDDEN");
      if (t >= challengeWindowEndsAt(row, ruleset).getTime()) {
        return fail("WINDOW_CLOSED");
      }
      if (event.reason.trim() === "") return fail("REASON_REQUIRED");
      return ok({ status: "disputed", disputedBy: event.actor });

    case "withdraw": {
      if (event.actor !== row.disputedBy) return fail("FORBIDDEN");
      const grace = t + ruleset.withdrawGraceH * HOUR;
      return ok(
        {
          status: "pending",
          disputedBy: null,
          finalizesAt: new Date(
            Math.max(challengeWindowEndsAt(row, ruleset).getTime(), grace),
          ),
        },
        "withdrawn",
      );
    }

    case "concede":
      if (event.actor !== row.doneBy) return fail("FORBIDDEN");
      return ok(
        { status: "voided", voidReason: "conceded", disputedBy: null },
        "conceded",
      );

    case "undo":
      if (event.actor !== row.loggedBy) return fail("FORBIDDEN");
      if (t > row.loggedAt.getTime() + ruleset.undoWindowMin * MINUTE) {
        return fail("WINDOW_CLOSED");
      }
      return ok(
        { status: "voided", voidReason: "undone", disputedBy: null },
        status === "disputed" ? "undone" : null,
      );

    case "resolve":
      // An admin may not rule on their own claim.
      if (!event.actorIsAdmin || event.actor === row.doneBy) {
        return fail("FORBIDDEN");
      }
      return event.outcome === "uphold"
        ? ok(
            {
              status: "confirmed",
              disputedBy: null,
              verifiedBy: event.actor,
              verifiedAt: now,
            },
            "upheld",
          )
        : ok(
            { status: "voided", voidReason: "disputed", disputedBy: null },
            "overruled",
          );
  }
}

/**
 * Verified (SPEC §4.1): someone other than `done_by` logged the completion, or
 * an admin upheld it.
 */
export function isVerified(
  row: Pick<VerificationRow, "doneBy" | "verifiedBy">,
): boolean {
  return row.verifiedBy !== null && row.verifiedBy !== row.doneBy;
}
