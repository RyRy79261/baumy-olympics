"use server";

import { revalidatePath } from "next/cache";
import type { AdjustPointsData } from "@/lib/actions/adjust-points";
import type { ActionResult } from "@/lib/actions/result";
import type { SetPrizeModeData } from "@/lib/actions/set-prize-mode";
import { actionForm } from "@/lib/actions/ui";

// /scores' server actions: thin wrappers around the registry. The actions
// themselves refuse anyone but an admin session (SPEC §12 decision 10).

export async function adjustPointsAction(
  _prev: ActionResult<AdjustPointsData> | null,
  form: FormData,
): Promise<ActionResult<AdjustPointsData>> {
  const result = await actionForm("adjust_points", form);
  if (result.ok) {
    revalidatePath("/scores");
    revalidatePath("/pot");
  }
  return result;
}

export async function setPrizeModeAction(
  _prev: ActionResult<SetPrizeModeData> | null,
  form: FormData,
): Promise<ActionResult<SetPrizeModeData>> {
  const result = await actionForm("set_prize_mode", form);
  if (result.ok) {
    revalidatePath("/scores");
    revalidatePath("/pot");
  }
  return result;
}
