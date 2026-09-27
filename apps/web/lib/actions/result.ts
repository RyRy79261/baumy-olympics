// The result every action returns, on every surface (SPEC §6.3):
// `{ ok: true, data } | { ok: false, code, message }`.
//
// Pure and client-safe: server actions return these to client components,
// which read `code`, `message` and `fieldErrors` from them.

/** Codes `runAction` itself returns. Domain actions add their own. */
export type PlatformErrorCode =
  /** No action by that name. */
  | "UNKNOWN_ACTION"
  /** The action is not offered on the calling surface. */
  | "SURFACE_FORBIDDEN"
  /** The input (or the request id) failed validation; see `issues`. */
  | "INVALID_INPUT"
  /** Nobody is signed in. */
  | "UNAUTHENTICATED"
  /** Signed in, but this actor may not do this. */
  | "FORBIDDEN"
  /** A kiosk action that needs the member's PIN was sent without one. */
  | "ATTESTATION_REQUIRED"
  /** The PIN sent with a kiosk action was not accepted. */
  | "ATTESTATION_FAILED"
  /** The member's kiosk PIN is locked after 10 failures in 24h. */
  | "PIN_LOCKED"
  | "RATE_LIMITED"
  /** The request id was already used for a different input. */
  | "IDEMPOTENCY_CONFLICT"
  /** The same request is still running elsewhere. */
  | "IN_PROGRESS"
  | "NOT_FOUND"
  /** An integration has no credentials on this deployment (Blob, Google). */
  | "NOT_CONFIGURED"
  /** An integration failed just now; trying again may work. */
  | "UNAVAILABLE"
  /** Something threw. The message is generic; the log has the detail. */
  | "INTERNAL";

/** Codes the actions themselves return, each with a sentence to act on. */
export type DomainErrorCode =
  /** No invite code by that spelling. */
  | "INVITE_NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  /** Every use of the code is taken. */
  | "INVITE_USED_UP"
  /** The account already belongs to an active member. */
  | "ALREADY_MEMBER"
  /** The account's member was deactivated; only an admin can bring it back. */
  | "MEMBERSHIP_ENDED"
  /** `join_as_founder` from an email that is not on FOUNDER_EMAILS. */
  | "NOT_A_FOUNDER"
  | "EMAIL_NOT_VERIFIED"
  /** The change would leave the household without an active admin. */
  | "LAST_ADMIN"
  /** Needs the current password or a session under 10 minutes old. */
  | "REAUTH_REQUIRED"
  /** The chore was done too recently; `retryAt` says when it may be logged. */
  | "COOLDOWN"
  /** A completion more than 2 minutes in the future. */
  | "FUTURE"
  /** A completion more than 24h ago. */
  | "BACKDATE_TOO_FAR"
  /** A completion before the chore's last one; history is append-only. */
  | "OUT_OF_ORDER"
  | "SEASON_CLOSED"
  | "PHOTO_REQUIRED"
  | "ARCHIVED_CHORE"
  /** The chore has no points set for that time. */
  | "NO_RULE_VERSION"
  /** Another chore that is not archived already has that name. */
  | "CHORE_NAME_TAKEN"
  /**
   * The claim is not in a state the event applies to at `now` (it already
   * finalized, expired, was confirmed, or someone else just changed it).
   */
  | "INVALID_STATE"
  /** The 24h dispute window or the 10-minute undo window has passed. */
  | "WINDOW_CLOSED"
  /** A dispute needs a reason. */
  | "REASON_REQUIRED"
  /** The claim already has its proof photo. */
  | "PHOTO_ALREADY_ATTACHED"
  /** `attach_completion_photo` without a photo from the upload route. */
  | "PHOTO_MISSING"
  /** The season already has a completion, so its prize mode is fixed. */
  | "PRIZE_MODE_LOCKED"
  /** A prize mode v1 does not play (`heaviest_streak`, `longest_streak`). */
  | "PRIZE_MODE_NOT_SUPPORTED"
  /** An admin tried to approve their own point adjustment. */
  | "SELF_APPROVAL";

export type ActionErrorCode = PlatformErrorCode | DomainErrorCode;

/** One validation problem, reduced to what serialises and a form can show. */
export interface InputIssue {
  path: (string | number)[];
  message: string;
}

export interface ActionFailure {
  ok: false;
  code: ActionErrorCode;
  /** A sentence the user can act on. Never SQL, a stack or a secret. */
  message: string;
  /** With INVALID_INPUT: the Zod issues. */
  issues?: InputIssue[];
  /** With RATE_LIMITED. */
  retryAfterSeconds?: number;
  /** With COOLDOWN: when it may be tried again, ISO 8601. */
  retryAt?: string;
}

export interface ActionSuccess<O> {
  ok: true;
  data: O;
}

export type ActionResult<O> = ActionSuccess<O> | ActionFailure;

export function fail(
  code: ActionErrorCode,
  message: string,
  extra: Pick<ActionFailure, "issues" | "retryAfterSeconds" | "retryAt"> = {},
): ActionFailure {
  return { ok: false, code, message, ...extra };
}

/**
 * INVALID_INPUT issues grouped by their top-level field, for inline form
 * errors. Issues about the whole input go under `""`.
 */
export function fieldErrors(
  result: ActionResult<unknown> | null | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!result || result.ok || !result.issues) return out;
  for (const issue of result.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
