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
  | "RATE_LIMITED"
  /** The request id was already used for a different input. */
  | "IDEMPOTENCY_CONFLICT"
  /** The same request is still running elsewhere. */
  | "IN_PROGRESS"
  | "NOT_FOUND"
  /** Something threw. The message is generic; the log has the detail. */
  | "INTERNAL";

export type ActionErrorCode = PlatformErrorCode;

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
}

export interface ActionSuccess<O> {
  ok: true;
  data: O;
}

export type ActionResult<O> = ActionSuccess<O> | ActionFailure;

export function fail(
  code: ActionErrorCode,
  message: string,
  extra: Pick<ActionFailure, "issues" | "retryAfterSeconds"> = {},
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
