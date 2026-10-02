"use server";

import { revalidatePath } from "next/cache";
import type { ClaimEventData } from "@/lib/actions/confirmations";
import type { ActionResult } from "@/lib/actions/result";
import { actionForm } from "@/lib/actions/ui";

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
  const result = await actionForm(name, form);
  if (result.ok) {
    revalidatePath("/activity");
    revalidatePath("/chores");
  }
  return result;
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
