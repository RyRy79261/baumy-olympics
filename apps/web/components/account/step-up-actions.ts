"use server";

import { actionInput } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { ActionOutput } from "@/lib/actions/registry";

// The "Confirm it's you" dialog's server actions (issue #135): thin wrappers
// around the registry, like every page's. The proof is a JSON value (a
// WebAuthn assertion does not fit a form), so they take an object.

type Result<N extends Parameters<typeof actionInput>[0]> = ActionResult<
  ActionOutput<N>
>;

export async function getStepUpAction(): Promise<Result<"get_step_up">> {
  return actionInput("get_step_up", {}, undefined);
}

export async function confirmIdentityAction(
  proof: unknown,
  requestId: string,
): Promise<Result<"confirm_identity">> {
  return actionInput("confirm_identity", proof, requestId);
}

export async function requestBaumyConfirmationAction(
  requestId: string,
): Promise<Result<"request_baumy_confirmation">> {
  return actionInput("request_baumy_confirmation", {}, requestId);
}

export async function getBaumyConfirmationAction(
  approvalId: string,
): Promise<Result<"get_baumy_confirmation">> {
  return actionInput("get_baumy_confirmation", { approvalId }, undefined);
}
