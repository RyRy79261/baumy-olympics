import { z } from "zod";

// A house calendar event at its boundaries (SPEC §3.3, §6.4): the create and
// edit sheets on /calendar, `create_event`, `update_event` and `list_events`
// all parse with these. Dates and times are Berlin wall time as people type
// them ("2027-01-15", "19:00"); the Google adapter sends them to Google as a
// local `dateTime` plus `timeZone: "Europe/Berlin"`, never with an offset.

export const EVENT_TITLE_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 2000;
export const EVENT_LOCATION_MAX = 200;
/** The longest event: a year, a typo guard. */
export const EVENT_MAX_DAYS = 366;
/** The widest `list_events` range: a month view with its edge weeks. */
export const LIST_EVENTS_MAX_DAYS = 62;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(s: string): boolean {
  const m = DATE_PATTERN.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

/** Whole days from `a` to `b`, both YYYY-MM-DD (negative when b is first). */
export function daysBetween(a: string, b: string): number {
  const at = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.round((at(b) - at(a)) / 86_400_000);
}

/** A day on the calendar, "YYYY-MM-DD" (what `<input type="date">` sends). */
export const CalendarDate = z
  .string({ error: "Pick a date." })
  .trim()
  .refine(isCalendarDate, "Pick a date (YYYY-MM-DD).");

/** A Berlin wall-clock time, "HH:MM" (what `<input type="time">` sends). */
export const CalendarTime = z
  .string({ error: "Pick a time." })
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time (HH:MM).");

/** An event at a time of day, or one that fills whole days. */
export const EventKind = z.enum(["timed", "all_day"], {
  error: "Pick a time of day or all day.",
});
export type EventKind = z.infer<typeof EventKind>;

export const EventTitle = z
  .string({ error: "Give the event a title." })
  .trim()
  .min(1, "Give the event a title.")
  .max(EVENT_TITLE_MAX, `Keep it to ${EVENT_TITLE_MAX} characters.`);

export const EventDescription = z
  .string()
  .trim()
  .max(
    EVENT_DESCRIPTION_MAX,
    `Keep it to ${EVENT_DESCRIPTION_MAX} characters.`,
  );

export const EventLocation = z
  .string()
  .trim()
  .max(EVENT_LOCATION_MAX, `Keep it to ${EVENT_LOCATION_MAX} characters.`);

/**
 * A Google event id. Ids we make are base32hex (0-9, a-v); the instances of
 * a recurring event add `_20270115T180000Z`, so letters, digits and `_`, 5 to
 * 1024 of them. Nothing that could leave the URL path segment.
 */
export const CalendarEventId = z
  .string({ error: "Pick an event." })
  .regex(/^[A-Za-z0-9_]{5,1024}$/, "Pick an event.");

/** The member an event is for (issue #134); none means the whole house. */
export const EventForMember = z.uuid("Pick someone in the house.");

/** The fields of an event, before the checks that tie them together. */
export const eventFieldsShape = {
  title: EventTitle,
  description: EventDescription.optional().describe(
    "Notes for the event. Optional.",
  ),
  location: EventLocation.optional().describe("Where. Optional."),
  kind: EventKind.describe(
    "`timed` needs startTime and endTime; `all_day` fills whole days.",
  ),
  date: CalendarDate.describe("The first day, YYYY-MM-DD, in Europe/Berlin."),
  endDate: CalendarDate.optional().describe(
    "The last day (inclusive), YYYY-MM-DD. Defaults to `date`.",
  ),
  startTime: CalendarTime.optional().describe(
    "Timed events: the Berlin wall-clock start, HH:MM (24h).",
  ),
  endTime: CalendarTime.optional().describe(
    "Timed events: the Berlin wall-clock end, HH:MM (24h), on endDate.",
  ),
  forMemberId: EventForMember.nullable()
    .optional()
    .describe(
      "Who it is for: one member's id, or null for the whole house. On create, left out is the whole house; on update, left out keeps who it is for.",
    ),
};

type EventFields = {
  kind: EventKind;
  date: string;
  endDate?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
};

/**
 * The checks across fields, shared by the create and update schemas: a
 * timed event needs both times and must end after it starts; an event may
 * not end before its first day, nor last more than a year.
 */
export function checkEventFields(v: EventFields, ctx: z.RefinementCtx): void {
  const endDate = v.endDate ?? v.date;
  const span = daysBetween(v.date, endDate);
  if (span < 0) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The last day can't be before the first.",
    });
    return;
  }
  if (span > EVENT_MAX_DAYS) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: `An event can last ${EVENT_MAX_DAYS} days at most.`,
    });
    return;
  }
  if (v.kind !== "timed") return;
  if (!v.startTime) {
    ctx.addIssue({
      code: "custom",
      path: ["startTime"],
      message: "Pick a start time.",
    });
  }
  if (!v.endTime) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "Pick an end time.",
    });
  }
  if (v.startTime && v.endTime && span === 0 && v.endTime <= v.startTime) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "End after it starts, or pick a later last day.",
    });
  }
}

/** `create_event`'s input. */
export const NewCalendarEvent = z
  .strictObject(eventFieldsShape)
  .superRefine(checkEventFields);
export type NewCalendarEvent = z.infer<typeof NewCalendarEvent>;

/** `update_event`'s input: the event's id and all of its fields. */
export const CalendarEventUpdate = z
  .strictObject({
    eventId: CalendarEventId.describe("The event's id, from list_events."),
    ...eventFieldsShape,
  })
  .superRefine(checkEventFields);
export type CalendarEventUpdate = z.infer<typeof CalendarEventUpdate>;

/** `list_events`'s input: a range of Berlin days, both ends inclusive. */
export const EventRange = z
  .strictObject({
    from: CalendarDate.optional().describe(
      "The first day, YYYY-MM-DD in Europe/Berlin. Defaults to today.",
    ),
    to: CalendarDate.optional().describe(
      `The last day (inclusive). Defaults to \`from\`. At most ${LIST_EVENTS_MAX_DAYS} days after it.`,
    ),
  })
  .superRefine((v, ctx) => {
    if (!v.from || !v.to) return;
    const span = daysBetween(v.from, v.to);
    if (span < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "The last day can't be before the first.",
      });
    } else if (span > LIST_EVENTS_MAX_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Ask for ${LIST_EVENTS_MAX_DAYS} days at most.`,
      });
    }
  });
export type EventRange = z.infer<typeof EventRange>;
