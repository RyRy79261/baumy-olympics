"use server";

import { actionForm } from "@/lib/actions/ui";
import type { CreateReminderData } from "@/lib/actions/reminders";
import type { ActionResult } from "@/lib/actions/result";

// The hub's reminder form (issue #66): a thin wrapper around the registry
// (SPEC §6.3).

/** Post a reminder: the kitchen screen shows it full-screen. */
export async function createReminderAction(
  _prev: ActionResult<CreateReminderData> | null,
  form: FormData,
): Promise<ActionResult<CreateReminderData>> {
  return actionForm("create_reminder", form);
}
