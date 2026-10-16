"use server";

import type { AdjustPointsData } from "@/lib/actions/adjust-points";
import type { ActionResult } from "@/lib/actions/result";
import type { SetPrizeModeData } from "@/lib/actions/set-prize-mode";
import { actionFormRefreshing } from "@/lib/actions/ui";

// /scores' server actions: thin wrappers around the registry. The actions
// themselves refuse anyone but an admin session (SPEC §12 decision 10).

export async function adjustPointsAction(
  _prev: ActionResult<AdjustPointsData> | null,
  form: FormData,
): Promise<ActionResult<AdjustPointsData>> {
  return actionFormRefreshing("adjust_points", form);
}

export async function setPrizeModeAction(
  _prev: ActionResult<SetPrizeModeData> | null,
  form: FormData,
): Promise<ActionResult<SetPrizeModeData>> {
  return actionFormRefreshing("set_prize_mode", form);
}
