"use server";

import type {
  CalendarWriteData,
  DeleteEventData,
} from "@/lib/actions/calendar";
import type { ActionResult } from "@/lib/actions/result";
import { eventFormInput } from "@/lib/calendar/view";
import { actionFormRefreshing } from "@/lib/actions/ui";

// /calendar's server actions: thin wrappers around the registry (SPEC §3.3).
// Google is called by the action with no transaction open; the page then
// re-reads the range (the adapter's read cache was cleared by the write).

type WriteResult = ActionResult<CalendarWriteData>;

export async function createEventAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  return actionFormRefreshing("create_event", form, eventFormInput);
}

export async function updateEventAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  return actionFormRefreshing("update_event", form, eventFormInput);
}

export async function deleteEventAction(
  _prev: ActionResult<DeleteEventData> | null,
  form: FormData,
): Promise<ActionResult<DeleteEventData>> {
  return actionFormRefreshing("delete_event", form);
}
