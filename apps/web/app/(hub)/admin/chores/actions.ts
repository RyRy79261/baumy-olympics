"use server";

import type { ActionResult } from "@/lib/actions/result";
import type { ManageChoreData } from "@/lib/actions/manage-chore";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";
import { actionFormRefreshing } from "@/lib/actions/ui";
import { changesFromForm } from "@/lib/chores/bulk-edit";

// /admin/chores' server actions: thin wrappers around the registry. The
// actions themselves refuse anyone but an admin session (SPEC §12 decision 10).

export async function manageChoreAction(
  _prev: ActionResult<ManageChoreData> | null,
  form: FormData,
): Promise<ActionResult<ManageChoreData>> {
  return actionFormRefreshing("manage_chore", form);
}

/** Many bounties in one save, all or none (issue #175). */
export async function updateBountiesAction(
  _prev: ActionResult<UpdateBountiesData> | null,
  form: FormData,
): Promise<ActionResult<UpdateBountiesData>> {
  return actionFormRefreshing("update_bounties", form, changesFromForm);
}
