"use server";

import { revalidatePath } from "next/cache";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { ActionResult } from "@/lib/actions/result";
import { actionForm } from "@/lib/actions/ui";

// /chores' server action: a thin wrapper around the registry (SPEC §6.3).

export async function logCompletionAction(
  _prev: ActionResult<LogCompletionData> | null,
  form: FormData,
): Promise<ActionResult<LogCompletionData>> {
  const result = await actionForm("log_completion", form);
  if (result.ok) {
    revalidatePath("/chores");
    revalidatePath("/admin/chores");
  }
  return result;
}
