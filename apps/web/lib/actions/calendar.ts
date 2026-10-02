import { createHash } from "node:crypto";
import { z } from "zod";
import {
  addDaysToDateKey,
  berlinDateKey,
  berlinDateTimeToUtc,
} from "@baumy/core";
import {
  CalendarEventId,
  CalendarEventUpdate,
  EventRange,
  LIST_EVENTS_MAX_DAYS,
  NewCalendarEvent,
  daysBetween,
} from "@baumy/types";
import { findActiveMember } from "@baumy/db/members";
import { eventView, type CalendarEventView } from "@/lib/calendar/view";
import { calendarClient } from "@/lib/integrations/calendar";
import type {
  CalendarEvent,
  CalendarFailure,
  EventSpec,
} from "@/lib/integrations/google-calendar";
import {
  defineAction,
  type ActionCtx,
  type PreviewRefusal,
  type RequestCtx,
} from "./define";
import { fail, type ActionFailure } from "./result";

// The shared house calendar (SPEC §3.3, §6.4, issue #19). The events live in
// Google only; Olympics keeps no copy, just the audit row of each change.
//
// Writes are `transactional: false`: runAction commits the idempotency claim,
// calls `execute` with NO transaction open (so a slow Google never holds a
// pooled connection), then writes the audit row in a short transaction of
// its own. If that audit write fails, runAction calls the `undo` each write
// returns: a create deletes the event again, an update puts the old fields
// back and a delete restores the event (camp-404
// `packages/db/src/calendar-events.ts`).
//
// Private and confidential events are never shown, and cannot be changed or
// deleted from here: the calendar is shared, and the kitchen screen is too.
//
// The writes are `member`: on the kiosk the acting member changes the
// calendar with no PIN, since an event touches nobody's points (owner ruling
// 2026-10-02, SPEC §12 decision 27, issue #145; issue #134 had made them
// `attested`).

/** The calendar's failures as sentences people can act on. */
export function calendarFailure(r: CalendarFailure): ActionFailure {
  switch (r.reason) {
    case "not_configured":
      return fail(
        "NOT_CONFIGURED",
        "The house calendar is not connected yet. An admin can set it up (docs/SETUP.md).",
      );
    case "not_found":
      return fail("NOT_FOUND", "That event is not on the calendar any more.");
    default:
      return fail(
        "UNAVAILABLE",
        "Google Calendar did not answer. Try again in a minute.",
      );
  }
}

/**
 * The Google id for a create: made from who asked and their request id, so a
 * retry of the same request (after a timeout, say) names the same event and
 * Google's 409 tells us it is already there. Hex is inside Google's base32hex.
 */
export function eventIdFor(ctx: RequestCtx): string {
  return createHash("sha256")
    .update(
      `baumy-event:${ctx.actor.memberId ?? ""}:${ctx.source}:${ctx.requestId ?? ""}`,
    )
    .digest("hex")
    .slice(0, 32);
}

type Fields = z.output<typeof NewCalendarEvent>;

/** The parsed fields as the adapter takes them. */
export function specOf(i: Fields): EventSpec {
  const allDay = i.kind === "all_day";
  return {
    title: i.title,
    description: i.description || null,
    location: i.location || null,
    allDay,
    date: i.date,
    endDate: i.endDate ?? i.date,
    ...(allDay ? {} : { startTime: i.startTime!, endTime: i.endTime! }),
    // Left out: undefined, which an update reads as "keep who it is for".
    forMember: i.forMemberId,
  };
}

/** An event read back from Google as the fields to write it again (undo). */
export function specOfEvent(e: CalendarEvent): EventSpec {
  const v = eventView(e);
  return {
    title: e.title,
    description: e.description,
    location: e.location,
    allDay: e.allDay,
    date: v.startDate,
    endDate: v.endDate,
    ...(e.allDay ? {} : { startTime: v.startTime!, endTime: v.endTime! }),
    forMember: e.forMember,
  };
}

/**
 * Who the event is for must be an active member of this household; anyone
 * else is an input error on that field, before Google is called.
 */
async function checkForMember(
  ctx: ActionCtx,
  forMemberId: string | null | undefined,
): Promise<ActionFailure | null> {
  if (!forMemberId) return null;
  const member = await findActiveMember(ctx.db, ctx.householdId, forMemberId);
  if (member) return null;
  return fail("INVALID_INPUT", PICK_SOMEONE, {
    issues: [{ path: ["forMemberId"], message: PICK_SOMEONE }],
  });
}

const PICK_SOMEONE = "Pick someone in the house.";

/**
 * What a preview adds about who it is for: nothing when it is not said (or,
 * adding, when it is the house), "for everyone" or "for Anna" when it is;
 * a refusal, before the card, for someone who is not in the house.
 */
async function forPhrase(
  ctx: ActionCtx,
  forMemberId: string | null | undefined,
  adding: boolean,
): Promise<string | PreviewRefusal> {
  if (forMemberId === undefined) return "";
  if (forMemberId === null) return adding ? "" : " and make it for everyone";
  const member = await findActiveMember(ctx.db, ctx.householdId, forMemberId);
  if (!member) return { invalid: PICK_SOMEONE };
  return adding
    ? ` for ${member.displayName}`
    : ` and make it for ${member.displayName}`;
}

/** Private events stay hidden: to this app they do not exist. */
async function visibleEvent(
  eventId: string,
): Promise<{ ok: true; event: CalendarEvent } | ActionFailure> {
  const got = await calendarClient().get(eventId);
  if (!got.ok) return calendarFailure(got);
  if (got.data.private)
    return calendarFailure({ ok: false, reason: "not_found" });
  return { ok: true, event: got.data };
}

export interface ListEventsData {
  from: string;
  to: string;
  events: CalendarEventView[];
}

export const listEvents = defineAction({
  name: "list_events",
  title: "Calendar",
  description:
    "Lists the house calendar's events between two Berlin days (inclusive; both default to today), soonest first, with each event's id, title, notes, place, whether it is all day, its first and last day, its Berlin start and end time (HH:MM), who added it and who it is for (member ids; null for the whole house). Private events are left out.",
  consent: "See the house calendar",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: "display",
  input: EventRange,
  async execute(ctx, input) {
    const from = input.from ?? berlinDateKey(ctx.now);
    const to = input.to ?? from;
    const days = daysBetween(from, to);
    if (days < 0 || days > LIST_EVENTS_MAX_DAYS) {
      return fail(
        "INVALID_INPUT",
        `Ask for up to ${LIST_EVENTS_MAX_DAYS} days, starting from the first.`,
        { issues: [{ path: ["to"], message: "Pick a later last day." }] },
      );
    }
    const listed = await calendarClient().list({
      timeMin: berlinDateTimeToUtc(from),
      timeMax: berlinDateTimeToUtc(addDaysToDateKey(to, 1)),
    });
    if (!listed.ok) return calendarFailure(listed);
    const data: ListEventsData = {
      from,
      to,
      events: listed.data.filter((e) => !e.private).map(eventView),
    };
    return { ok: true, data };
  },
});

/** What a calendar write returns. */
export interface CalendarWriteData {
  event: CalendarEventView;
}

function previewWhen(i: Fields): string {
  const s = specOf(i);
  return eventView({
    id: "preview",
    title: s.title,
    description: null,
    location: null,
    allDay: s.allDay,
    start: s.allDay
      ? s.date
      : berlinDateTimeToUtc(s.date, s.startTime).toISOString(),
    end: s.allDay
      ? addDaysToDateKey(s.endDate, 1)
      : berlinDateTimeToUtc(s.endDate, s.endTime).toISOString(),
    member: null,
    forMember: null,
  }).when;
}

export const createEvent = defineAction({
  name: "create_event",
  title: "Add a calendar event",
  description:
    "Adds an event to the house calendar. Dates are Berlin days (YYYY-MM-DD) and times Berlin wall-clock times (HH:MM, 24h); give startTime and endTime for a `timed` event, or kind `all_day`. endDate is the last day, inclusive, and defaults to date. forMemberId names the one member it is for; leave it out (or null) for the whole house.",
  consent: "Add events to the house calendar",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: "member",
  transactional: false,
  input: NewCalendarEvent,
  async preview(ctx, i) {
    const who = await forPhrase(ctx, i.forMemberId, true);
    if (typeof who !== "string") return who;
    return `Add "${i.title}" on ${previewWhen(i)}${who}`;
  },
  async execute(ctx: ActionCtx, i) {
    const badFor = await checkForMember(ctx, i.forMemberId);
    if (badFor) return badFor;
    const client = calendarClient();
    const eventId = eventIdFor(ctx);
    const created = await client.create(
      eventId,
      specOf(i),
      ctx.actor.memberId!,
    );
    if (!created.ok) {
      // A create has no event to miss; a 404 here is the calendar itself.
      return calendarFailure(
        created.reason === "not_found"
          ? { ok: false, reason: "unavailable" }
          : created,
      );
    }
    const data: CalendarWriteData = { event: eventView(created.data) };
    return {
      ok: true,
      data,
      audit: { entity: "calendar_event", entityId: eventId },
      undo: async () => {
        await client.delete(eventId);
      },
    };
  },
});

export const updateEvent = defineAction({
  name: "update_event",
  title: "Change a calendar event",
  description:
    "Changes an event on the house calendar: send its id (from list_events) and ALL of its fields as they should be, the same as for create_event, except forMemberId: leave it out to keep who it is for, or null to make it the whole house's.",
  consent: "Change events on the house calendar",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: "member",
  transactional: false,
  input: CalendarEventUpdate,
  async preview(ctx, i) {
    const who = await forPhrase(ctx, i.forMemberId, false);
    if (typeof who !== "string") return who;
    return `Change "${i.title}" to ${previewWhen(i)}${who}`;
  },
  async execute(ctx, i) {
    const badFor = await checkForMember(ctx, i.forMemberId);
    if (badFor) return badFor;
    const before = await visibleEvent(i.eventId);
    if (!before.ok) return before;
    const client = calendarClient();
    const updated = await client.update(i.eventId, specOf(i));
    if (!updated.ok) return calendarFailure(updated);
    const previous = specOfEvent(before.event);
    const data: CalendarWriteData = { event: eventView(updated.data) };
    return {
      ok: true,
      data,
      audit: { entity: "calendar_event", entityId: i.eventId },
      undo: async () => {
        await client.update(i.eventId, previous);
      },
    };
  },
});

export interface DeleteEventData {
  eventId: string;
  title: string;
}

export const deleteEvent = defineAction({
  name: "delete_event",
  title: "Delete a calendar event",
  description:
    "Deletes an event from the house calendar, by its id from list_events. Always confirm with the person first.",
  consent: "Delete events from the house calendar",
  kind: "write",
  risk: "destructive",
  // Brain behind its confirm button (issue #70); never MCP.
  surfaces: ["ui", "kiosk", "ai", "brain"],
  requires: "member",
  transactional: false,
  input: z.strictObject({
    eventId: CalendarEventId.describe("The event's id, from list_events."),
  }),
  async preview(_ctx, i) {
    const got = await calendarClient().get(i.eventId);
    return got.ok && !got.data.private
      ? `Delete "${got.data.title}" (${eventView(got.data).when})`
      : "Delete this event";
  },
  async execute(_ctx, i) {
    const before = await visibleEvent(i.eventId);
    if (!before.ok) return before;
    const client = calendarClient();
    const deleted = await client.delete(i.eventId);
    if (!deleted.ok) return calendarFailure(deleted);
    const data: DeleteEventData = {
      eventId: i.eventId,
      title: before.event.title,
    };
    return {
      ok: true,
      data,
      audit: {
        entity: "calendar_event",
        entityId: i.eventId,
        payload: { eventId: i.eventId, title: before.event.title },
      },
      undo: async () => {
        await client.restore(i.eventId);
      },
    };
  },
});
