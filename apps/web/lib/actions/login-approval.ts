import { z } from "zod";
import {
  decideLoginRequest,
  lockLoginRequest,
  type LoginRequestState,
} from "@baumy/db/login-requests";
import { LoginCode, LoginRequestId } from "@baumy/types";
import { defineAction, type ActionCtx } from "./define";
import { fail } from "./result";

// "Sign in with Baumy" (issue #80, ADR 0006): the member's answer to the DM
// brain sent ("Sign in on Chrome on macOS? Tap the number on the screen").
// Only brain's buttons call these, as the member themself: never on anyone's
// behalf (`ownWordOnly`), and only for a request made for that very member;
// anyone else's reads as not there at all.
//
// - approve_login: the tapped number must be the one on the screen. A decoy
//   denies the request.
//   That is still a success: the transaction must keep the denial, and brain
//   tells the member what happened.
// - deny_login: the member tapped Deny.
// Either denial makes the start route refuse this method for that member
// for 15 minutes: someone may be pushing sign-ins at them (push fatigue).
//
// Each decision is a compare-and-set on `pending` under the row's lock, so a
// second tap, a replay with a new key or an expired request changes nothing.
//
// The same buttons answer a "Confirm it's you" request (issue #135, ADR
// 0007): a member already signed in confirms that session from Telegram.
// The decision is the same; `purpose` in the answer tells brain which reply
// to send, and approving one signs nobody in.

export interface LoginDecision {
  /** `approved`: the browser signs in; `blocked`: a decoy was tapped. */
  outcome: "approved" | "blocked" | "denied";
  /** "Chrome on macOS", for brain's reply. */
  device: string;
  /**
   * `sign_in`, or `step_up` for a "Confirm it's you" request (issue #135):
   * the browser is already signed in, and the tap confirms that session.
   */
  purpose: "sign_in" | "step_up";
}

const GONE = fail(
  "NOT_FOUND",
  "That sign-in request is not there. It may have been for someone else.",
);

function notPending(state: LoginRequestState) {
  return fail(
    "INVALID_STATE",
    state === "expired"
      ? "That sign-in request expired. Start again on the sign-in page."
      : "That sign-in request was already answered.",
  );
}

/** The request, locked, if it is this member's and still pending. */
async function pendingFor(ctx: ActionCtx, requestId: string) {
  const memberId = ctx.actor.memberId;
  if (ctx.actor.kind !== "service" || !memberId) {
    return {
      ok: false as const,
      failure: fail(
        "FORBIDDEN",
        "Only your own Telegram account can answer a sign-in request.",
      ),
    };
  }
  const row = await lockLoginRequest(ctx.db, requestId, memberId, ctx.now);
  if (!row) return { ok: false as const, failure: GONE };
  if (row.state !== "pending") {
    return { ok: false as const, failure: notPending(row.state) };
  }
  return { ok: true as const, row };
}

const audit = (id: string, outcome: string) => ({
  entity: "login_request",
  entityId: id,
  payload: { requestId: id, outcome },
});

export const approveLogin = defineAction({
  name: "approve_login",
  title: "Approve a sign-in",
  description:
    "Approves a 'Sign in with Baumy' request with the number the member tapped in the DM Baumy sent them. Only from that DM's buttons, never from a conversation. A number that is not the one on the sign-in screen blocks the sign-in.",
  consent: "Approve a sign-in to Baumy Olympics from Telegram",
  kind: "write",
  risk: "confirm",
  surfaces: ["brain"],
  requires: "attested",
  ownWordOnly: true,
  rateLimit: { perMember: 10, perIp: 60, windowMs: 10 * 60_000 },
  input: z.strictObject({ requestId: LoginRequestId, code: LoginCode }),
  async execute(ctx, { requestId, code }) {
    const found = await pendingFor(ctx, requestId);
    if (!found.ok) return found.failure;
    const { row } = found;
    const right = code === row.code;
    const decided = await decideLoginRequest(
      ctx.db,
      row.id,
      right
        ? { status: "approved", now: ctx.now }
        : { status: "denied", reason: "wrong_code", now: ctx.now },
    );
    // Under the row lock and after the pending check, only a clock that
    // moved past the expiry in between can lose this.
    if (!decided) return notPending("expired");
    const data: LoginDecision = {
      outcome: right ? "approved" : "blocked",
      device: row.device,
      purpose: row.purpose,
    };
    return {
      ok: true,
      data,
      audit: audit(row.id, right ? "approved" : "wrong_code"),
    };
  },
});

export const denyLogin = defineAction({
  name: "deny_login",
  title: "Deny a sign-in",
  description:
    "Denies a 'Sign in with Baumy' request: the member tapped Deny in the DM Baumy sent them. Only from that DM's buttons.",
  consent: "Deny a sign-in to Baumy Olympics from Telegram",
  kind: "write",
  risk: "safe",
  surfaces: ["brain"],
  requires: "attested",
  ownWordOnly: true,
  rateLimit: { perMember: 10, perIp: 60, windowMs: 10 * 60_000 },
  input: z.strictObject({ requestId: LoginRequestId }),
  async execute(ctx, { requestId }) {
    const found = await pendingFor(ctx, requestId);
    if (!found.ok) return found.failure;
    const { row } = found;
    const decided = await decideLoginRequest(ctx.db, row.id, {
      status: "denied",
      reason: "denied",
      now: ctx.now,
    });
    if (!decided) return notPending("expired");
    const data: LoginDecision = {
      outcome: "denied",
      device: row.device,
      purpose: row.purpose,
    };
    return { ok: true, data, audit: audit(row.id, "denied") };
  },
});
