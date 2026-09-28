import { z } from "zod";

// A reminder at its boundaries (ADR 0005 §4, SPEC §5 `reminders`):
// `create_reminder`, `acknowledge_reminder`, `dismiss_reminder` and
// `list_reminders` all parse with these. A reminder is a title and a short
// body the kitchen screen shows full-screen until everyone has seen it.

export const REMINDER_TITLE_MAX = 80;
export const REMINDER_BODY_MAX = 280;

export const ReminderTitle = z
  .string({ error: "Give the reminder a title." })
  .trim()
  .min(1, "Give the reminder a title.")
  .max(REMINDER_TITLE_MAX, `Keep it to ${REMINDER_TITLE_MAX} characters.`);

/** Plain text, shown as it is (never markdown). */
export const ReminderBody = z
  .string({ error: "Write the reminder as text." })
  .trim()
  .max(REMINDER_BODY_MAX, `Keep it to ${REMINDER_BODY_MAX} characters.`);

export const ReminderId = z.uuid("Pick a reminder.");

export const NewReminder = z.strictObject({
  title: ReminderTitle.describe(
    'A short headline, e.g. "Handyman on Wednesday".',
  ),
  body: ReminderBody.optional().describe(
    "A sentence or two of detail, as plain text. Optional.",
  ),
});

export const ReminderRef = z.strictObject({
  reminderId: ReminderId.describe("The reminder's id, from list_reminders."),
});

export const ListRemindersInput = z.strictObject({});
