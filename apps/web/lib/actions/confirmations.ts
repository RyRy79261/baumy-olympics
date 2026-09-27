import { z } from "zod";
import type { VerificationEvent } from "@baumy/core";
import {
  applyCompletionEvent,
  loadForVerification,
  type CompletionEventFailure,
} from "@baumy/db/confirmations";
import type { Queryable } from "@baumy/db";
import { findActiveMember } from "@baumy/db/members";
import { DisputeReason } from "@baumy/types";
import { defineAction, type ActionCtx, type Gate } from "./define";
import { fail, type ActionFailure } from "./result";

// The honesty layer (SPEC §4.3): confirm, dispute, undo, withdraw, concede and
// the admin's ruling. Each is one `transition` in packages/core, applied by
// `applyCompletionEvent` (packages/db) under the chore lock with a
// compare-and-set on the stored status, in runAction's transaction. The
// status every event is judged on is the one the claim has at `ctx.now`
// (`effectiveStatus`), so the answer is the same whether or not the daily job
// has written a finalize or an expiry yet.
//
// On the kiosk each of these needs the acting member's PIN (`attested`): the
// iPad is shared, and these decide whose points count. A phone session, MCP
// or brain is its own member.

const completionId = z
  .uuid("Pick a claim.")
  .describe("The completion's id, from get_pending_confirmations.");

/** What every claim event returns. */
export interface ClaimEventData {
  completionId: string;
  choreName: string;
  /** The stored status after the event. */
  status: string;
  /** How the open dispute ended, when this event ended it. */
  disputeResolution: string | null;
  /** When a pending optimistic claim finalizes, ISO 8601. */
  finalizesAt: string | null;
}

const NOT_FOUND = fail("NOT_FOUND", "That claim was not found.");

/** The sentence for each way an event is refused. */
export function claimEventFailure(
  type: VerificationEvent["type"],
  r: CompletionEventFailure,
): ActionFailure {
  switch (r.code) {
    case "NOT_FOUND":
      return NOT_FOUND;
    case "STALE":
      return fail(
        "INVALID_STATE",
        "Someone else just changed this claim. Refresh and look again.",
      );
    case "REASON_REQUIRED":
      return fail("REASON_REQUIRED", "Say why you are disputing it.");
    case "WINDOW_CLOSED":
      return type === "undo"
        ? fail(
            "WINDOW_CLOSED",
            "Undo only works for 10 minutes after logging. Ask a housemate to dispute it instead.",
          )
        : fail(
            "WINDOW_CLOSED",
            "The 24-hour window to dispute this claim has closed.",
          );
    case "FORBIDDEN":
      return fail("FORBIDDEN", FORBIDDEN[type]);
    case "INVALID_STATE":
      return fail("INVALID_STATE", INVALID_STATE[type]);
  }
}

const FORBIDDEN: Record<VerificationEvent["type"], string> = {
  confirm: "You can't confirm your own claim. A housemate has to.",
  dispute: "You can't dispute your own claim. Undo or concede it instead.",
  withdraw: "Only the person who disputed it can withdraw the dispute.",
  concede: "Only the person who did it can concede.",
  undo: "Only the person who logged it can undo it.",
  resolve: "Admins can't rule on their own claim. Ask another admin.",
};

const INVALID_STATE: Record<VerificationEvent["type"], string> = {
  confirm: "This claim is not waiting for an OK any more.",
  dispute:
    "This claim can't be disputed any more: it is settled or already disputed.",
  withdraw: "There is no open dispute on this claim to withdraw.",
  concede: "There is no open dispute on this claim to concede.",
  undo: "This claim can't be undone any more.",
  resolve: "There is no open dispute on this claim to rule on.",
};

/** A one-line description of the claim, for previews. */
async function describeClaim(
  ctx: ActionCtx,
  id: string,
): Promise<string | null> {
  const loaded = await loadForVerification(ctx.db, ctx.householdId, id);
  if (!loaded) return null;
  const doer = await findActiveMember(
    ctx.db as Queryable,
    ctx.householdId,
    loaded.completion.doneBy,
  );
  return `${doer?.displayName ?? "Someone"}'s ${loaded.chore.name}`;
}

async function runEvent(ctx: ActionCtx, id: string, event: VerificationEvent) {
  const r = await applyCompletionEvent(ctx.db, {
    householdId: ctx.householdId,
    completionId: id,
    event,
    now: ctx.now,
  });
  if (!r.ok) return claimEventFailure(event.type, r);
  const data: ClaimEventData = {
    completionId: r.completion.id,
    choreName: r.choreName,
    status: r.completion.status,
    disputeResolution: r.disputeResolution,
    finalizesAt: r.completion.finalizesAt?.toISOString() ?? null,
  };
  return {
    ok: true as const,
    data,
    audit: { entity: "completion", entityId: r.completion.id },
  };
}

/** The kiosk needs the member's PIN for every one of these. */
const ATTESTED: Gate = "attested";

/** What confirm, undo, withdraw and concede share: only the claim's id. */
const byId = {
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: ATTESTED,
  input: z.strictObject({ completionId }),
} as const;

/** A preview line: "Confirm Ryan's Trash". */
function previewAs(verb: string) {
  return async (ctx: ActionCtx, i: { completionId: string }) => {
    const what = await describeClaim(ctx, i.completionId);
    return what ? `${verb} ${what}` : NOT_FOUND.message;
  };
}

export const confirmCompletion = defineAction({
  ...byId,
  name: "confirm_completion",
  title: "Confirm a chore",
  description:
    "Confirms a housemate's self-claimed chore that is waiting for an OK (pending), which verifies it. You cannot confirm your own. Refused with INVALID_STATE once it has finalized, expired or been disputed. Get ids from get_pending_confirmations.",
  consent: "Confirm your housemates' chores",
  preview: previewAs("Confirm"),
  execute: (ctx, i) =>
    runEvent(ctx, i.completionId, {
      type: "confirm",
      actor: ctx.actor.memberId!,
    }),
});

export const undoCompletion = defineAction({
  ...byId,
  name: "undo_completion",
  title: "Undo a logged chore",
  description:
    "Undoes a chore you logged yourself, within 10 minutes of logging it. It is voided and scores nothing. Refused with WINDOW_CLOSED after 10 minutes and FORBIDDEN for anyone but the person who logged it.",
  consent: "Undo chores you logged in the last 10 minutes",
  preview: previewAs("Undo"),
  execute: (ctx, i) =>
    runEvent(ctx, i.completionId, { type: "undo", actor: ctx.actor.memberId! }),
});

export const withdrawDispute = defineAction({
  ...byId,
  name: "withdraw_dispute",
  title: "Withdraw a dispute",
  description:
    "Withdraws a dispute you raised. The claim goes back to pending and counts again; it finalizes at the later of its original time and one hour from now. Only the person who disputed it can withdraw.",
  consent: "Withdraw disputes you raised",
  preview: previewAs("Withdraw the dispute on"),
  execute: (ctx, i) =>
    runEvent(ctx, i.completionId, {
      type: "withdraw",
      actor: ctx.actor.memberId!,
    }),
});

export const concedeCompletion = defineAction({
  ...byId,
  name: "concede_completion",
  title: "Concede a dispute",
  description:
    "Concedes a dispute on your own chore claim: the claim is voided and scores nothing. Only the person who did the chore can concede.",
  consent: "Concede disputes on your own chores",
  preview: previewAs("Concede"),
  execute: (ctx, i) =>
    runEvent(ctx, i.completionId, {
      type: "concede",
      actor: ctx.actor.memberId!,
    }),
});

export const disputeCompletion = defineAction({
  name: "dispute_completion",
  title: "Dispute a chore",
  description:
    "Disputes a housemate's self-claimed chore within 24 hours of logging, with a reason. While disputed it scores nothing but still blocks the chore's cooldown. It is voided when the window ends unless the doer attached a photo in time. You cannot dispute your own.",
  consent: "Dispute your housemates' chore claims",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: ATTESTED,
  input: z.strictObject({
    completionId,
    reason: DisputeReason.describe("Why you think it was not done."),
  }),
  async preview(ctx, i) {
    const what = await describeClaim(ctx, i.completionId);
    return what ? `Dispute ${what}: "${i.reason}"` : NOT_FOUND.message;
  },
  execute: (ctx, i) =>
    runEvent(ctx, i.completionId, {
      type: "dispute",
      actor: ctx.actor.memberId!,
      reason: i.reason,
    }),
});

export const resolveDispute = defineAction({
  name: "resolve_dispute",
  title: "Rule on a dispute",
  description:
    "An admin rules on an open dispute: uphold confirms the claim, void voids it. An admin cannot rule on their own claim.",
  consent: "Rule on disputed chores as an admin",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    completionId,
    outcome: z.enum(["uphold", "void"], "Pick uphold or void."),
  }),
  async preview(ctx, i) {
    const what = await describeClaim(ctx, i.completionId);
    if (!what) return NOT_FOUND.message;
    return i.outcome === "uphold" ? `Uphold ${what}` : `Void ${what}`;
  },
  execute: (ctx, i) =>
    runEvent(ctx, i.completionId, {
      type: "resolve",
      actor: ctx.actor.memberId!,
      // The admin gate has checked the role.
      actorIsAdmin: true,
      outcome: i.outcome,
    }),
});
