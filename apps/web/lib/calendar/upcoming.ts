import {
  addDaysToDateKey,
  berlinDateKey,
  berlinDateTimeToUtc,
  dateKeyWeekday,
  formatDateKey,
} from "@baumy/core";
import { LIST_EVENTS_MAX_DAYS } from "@baumy/types";
import type { CalendarEventView } from "./view";

// The kiosk's calendar manager (issue #134): the events still to come, as a
// list in three parts, Today, This week (to Sunday) and Later, as far ahead
// as one `list_events` read goes. Pure and client-safe: the page reads the
// range and the clock, and lays the groups out.

/** The days one read of the manager asks for: today and the 62 after it. */
export function upcomingRange(today: string): { from: string; to: string } {
  return { from: today, to: addDaysToDateKey(today, LIST_EVENTS_MAX_DAYS) };
}

export type UpcomingGroupKey = "today" | "week" | "later";

export interface UpcomingGroup {
  key: UpcomingGroupKey;
  title: string;
  /** What the group says when it has nothing. */
  empty: string;
  events: CalendarEventView[];
}

/** When an event starts, as an instant: an all-day one at Berlin midnight. */
function startsAt(e: CalendarEventView): number {
  return e.allDay
    ? berlinDateTimeToUtc(e.startDate).getTime()
    : Date.parse(e.start);
}

/** Whether it is over by `now`: an all-day event lasts its whole last day. */
export function hasEnded(e: CalendarEventView, now: Date): boolean {
  if (e.allDay) return e.endDate < berlinDateKey(now);
  return Date.parse(e.end) <= now.getTime();
}

/**
 * The events not yet over, soonest first (all-day ones first on their day),
 * in Today (anything on today, ones that began earlier too), This week (the
 * days after today to Sunday) and Later. On a Sunday, This week is empty.
 */
export function upcomingGroups(
  events: readonly CalendarEventView[],
  now: Date,
): UpcomingGroup[] {
  const today = berlinDateKey(now);
  const sunday = addDaysToDateKey(today, 7 - dateKeyWeekday(today));
  const last = upcomingRange(today).to;
  const groups: UpcomingGroup[] = [
    {
      key: "today",
      title: "Today",
      empty: "Nothing else today.",
      events: [],
    },
    {
      key: "week",
      title: "This week",
      empty:
        today === sunday ? "The week ends today." : "Nothing else this week.",
      events: [],
    },
    {
      key: "later",
      title: "Later",
      empty: `Nothing planned up to ${formatDateKey(last)}.`,
      events: [],
    },
  ];
  const sorted = events
    .filter((e) => !hasEnded(e, now))
    .sort(
      (a, b) =>
        startsAt(a) - startsAt(b) ||
        Number(b.allDay) - Number(a.allDay) ||
        a.title.localeCompare(b.title),
    );
  for (const e of sorted) {
    const at = e.startDate <= today ? 0 : e.startDate <= sunday ? 1 : 2;
    groups[at]!.events.push(e);
  }
  return groups;
}

/**
 * An event's time in the list, for its group: today it is "19:00" over
 * "to 20:30" (as the dashboard's day sheet shows it); on another day it is
 * that day over its time.
 */
export function upcomingTime(
  e: CalendarEventView,
  group: UpcomingGroupKey,
  today: string,
): { start: string; end: string } {
  if (group === "today") {
    if (e.allDay) return { start: "All day", end: "" };
    const start = e.startDate === today ? e.startTime! : "Now";
    if (e.endDate !== today) return { start, end: "till late" };
    return { start, end: `to ${e.endTime}` };
  }
  const day = formatDateKey(e.startDate);
  if (e.allDay) {
    return {
      start: day,
      end:
        e.endDate === e.startDate
          ? "All day"
          : `to ${formatDateKey(e.endDate)}`,
    };
  }
  return {
    start: day,
    end:
      e.endDate === e.startDate
        ? `${e.startTime}–${e.endTime}`
        : `${e.startTime} to ${formatDateKey(e.endDate)}`,
  };
}
