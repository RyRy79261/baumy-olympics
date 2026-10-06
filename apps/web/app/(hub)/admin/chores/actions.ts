"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/result";
import type { ManageChoreData } from "@/lib/actions/manage-chore";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";
import { actionForm } from "@/lib/actions/ui";
import { changesFromForm } from "@/lib/chores/bulk-edit";

// /admin/chores' server actions: thin wrappers around the registry. The
// actions themselves refuse anyone but an admin session (SPEC §12 decision 10).

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

/** Many bounties in one save, all or none (issue #175). */
export async function updateBountiesAction(
  _prev: ActionResult<UpdateBountiesData> | null,
  form: FormData,
): Promise<ActionResult<UpdateBountiesData>> {
  const result = await actionForm("update_bounties", form, changesFromForm);
  if (result.ok) {
    revalidatePath("/admin/chores");
    revalidatePath("/chores");
  }
  return result;
}
