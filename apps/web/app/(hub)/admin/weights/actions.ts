"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/result";
import type { WeightDecisionData } from "@/lib/actions/weights";
import { actionForm } from "@/lib/actions/ui";

// /admin/weights' server actions, the veto on /inbox and Change points on
// /chores: thin wrappers
// around the registry. `schedule_weight` and `dismiss_weight` refuse anyone
// but an admin session; `veto_weight` any member but the one who scheduled
// the change (SPEC §4.4, §12 decisions 5 and 10).

type Result = ActionResult<WeightDecisionData>;

async function run(
  name: "schedule_weight" | "dismiss_weight" | "veto_weight",
  form: FormData,
): Promise<Result> {
  const result = await actionForm(name, form);
  if (result.ok) {
    revalidatePath("/admin/weights");
    revalidatePath("/inbox");
    // The Bounties page's edit dialog schedules and cancels too (#109).
    revalidatePath("/chores");
  }
  return result;
}

export async function scheduleWeightAction(
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  return run("schedule_weight", form);
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
