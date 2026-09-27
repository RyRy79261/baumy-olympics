"use server";

import { revalidatePath } from "next/cache";
import type { AddPotContributionData } from "@/lib/actions/add-pot-contribution";
import type { ActionResult } from "@/lib/actions/result";
import { actionForm } from "@/lib/actions/ui";

// /pot's server action: a thin wrapper around the registry. The action
// refuses anyone but an admin session (SPEC §12 decision 10).

export async function addPotContributionAction(
  _prev: ActionResult<AddPotContributionData> | null,
  form: FormData,
): Promise<ActionResult<AddPotContributionData>> {
  const result = await actionForm("add_pot_contribution", form);
  if (result.ok) revalidatePath("/pot");
  return result;
}
