"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/result";
import type { ManageChoreData } from "@/lib/actions/manage-chore";
import { actionForm } from "@/lib/actions/ui";

// /admin/chores' server action: a thin wrapper around the registry. The
// action itself refuses anyone but an admin session (SPEC §12 decision 10).

export async function manageChoreAction(
  _prev: ActionResult<ManageChoreData> | null,
  form: FormData,
): Promise<ActionResult<ManageChoreData>> {
  const result = await actionForm("manage_chore", form);
  if (result.ok) {
    revalidatePath("/admin/chores");
    revalidatePath("/chores");
  }
  return result;
}
