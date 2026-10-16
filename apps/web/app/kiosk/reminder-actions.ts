"use server";

import { kioskActionAsFace, kioskActionForm } from "@/lib/actions/kiosk";
import type {
  AcknowledgeReminderData,
  DismissReminderData,
  ListRemindersData,
} from "@/lib/actions/reminders";
import type { ActionResult } from "@/lib/actions/result";

// The kitchen screen's full-screen reminder (ADR 0005 §4, issue #66):
// thin wrappers around the registry. A face's tap acts as that member for
// that one request (kioskActionAsFace), with no PIN and no change of pick.
// They refresh nothing: the reminder keeps its own state (the tick, then it
// closes) and asks for the next one itself.

/** The reminders on the kitchen screen now (the reminder's poll). */
export async function kioskRemindersAction(): Promise<
  ActionResult<ListRemindersData>
> {
  return kioskActionForm("list_reminders", new FormData());
}

/** "I've seen it" under a face: that member has seen it. */
export async function kioskSeenReminderAction(
  form: FormData,
): Promise<ActionResult<AcknowledgeReminderData>> {
  return kioskActionAsFace("acknowledge_reminder", form);
}

/** "Dismiss for everyone", as the member who said who they are. */
export async function kioskDismissReminderAction(
  form: FormData,
): Promise<ActionResult<DismissReminderData>> {
  return kioskActionAsFace("dismiss_reminder", form);
}
