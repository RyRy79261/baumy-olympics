"use server";

import type { ActionResult } from "@/lib/actions/result";
import type { WeightDecisionData } from "@/lib/actions/weights";
import { actionFormRefreshing } from "@/lib/actions/ui";

// /admin/weights' server actions, the veto on /activity and Change points on
// /chores (`schedule_points_change`, issue #115): thin wrappers around the
// registry. `schedule_weight` and `dismiss_weight` refuse anyone
// but an admin session; `veto_weight` any member but the one who scheduled
// the change (SPEC §4.4, §12 decisions 5 and 10).

type Result = ActionResult<WeightDecisionData>;

async function run(
  name:
    | "schedule_weight"
    | "schedule_points_change"
    | "dismiss_weight"
    | "veto_weight",
  form: FormData,
): Promise<Result> {
  return actionFormRefreshing(name, form);
}

export async function scheduleWeightAction(
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  return run("schedule_weight", form);
}

export async function schedulePointsChangeAction(
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  return run("schedule_points_change", form);
}

export async function dismissWeightAction(
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  return run("dismiss_weight", form);
}

export async function vetoWeightAction(
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  return run("veto_weight", form);
}
