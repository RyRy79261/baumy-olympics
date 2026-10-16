"use server";

import type { ClaimEventData } from "@/lib/actions/confirmations";
import type { ActionResult } from "@/lib/actions/result";
import { actionFormRefreshing } from "@/lib/actions/ui";

// /activity's server actions: thin wrappers around the registry (SPEC §6.3).
// Each refreshes the pages whose numbers a claim changes.

type Result = ActionResult<ClaimEventData>;

async function run(
  name:
    | "dispute_completion"
    | "undo_completion"
    | "withdraw_dispute"
    | "concede_completion"
    | "resolve_dispute",
  form: FormData,
): Promise<Result> {
  return actionFormRefreshing(name, form);
}

export async function disputeClaimAction(_prev: Result | null, form: FormData) {
  return run("dispute_completion", form);
}

export async function undoClaimAction(_prev: Result | null, form: FormData) {
  return run("undo_completion", form);
}

export async function withdrawDisputeAction(
  _prev: Result | null,
  form: FormData,
) {
  return run("withdraw_dispute", form);
}

export async function concedeClaimAction(_prev: Result | null, form: FormData) {
  return run("concede_completion", form);
}

export async function resolveDisputeAction(
  _prev: Result | null,
  form: FormData,
) {
  return run("resolve_dispute", form);
}
