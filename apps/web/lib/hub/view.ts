import {
  addDaysToDateKey,
  berlinDateKey,
  berlinDateTimeToUtc,
  berlinTimeKey,
  formatBerlinDateTime,
  formatDateKey,
} from "@baumy/core";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { ActionResult } from "@/lib/actions/result";
import type { CalendarEventView } from "@/lib/calendar/view";
import { streakLabel } from "@/lib/chores/view";

// What the hub's widgets show (SPEC §3.1, issue #20). Pure and client-safe:
// the hub and the kiosk home read the same actions every other surface
// reads, and these pick out what fits on one screen. Each widget stands on
// its own: one action failing (Google down, say) makes that widget say so,
// and the rest of the page is unaffected.

/** One widget's content: its data, nothing to show, or a failure. */
export type WidgetState<T> =
  | { status: "ready"; data: T }
  | { status: "empty"; message: string }
  | { status: "unavailable"; message: string };

/**
 * An action's result as a widget's state. `pick` turns the data into what
 * the widget lists; an empty list is the widget's `empty` sentence.
 */
export function widgetState<D, T>(
  result: ActionResult<D>,
  pick: (data: D) => T[],
  empty: string,
): WidgetState<T[]> {
  if (!result.ok) return { status: "unavailable", message: result.message };
  const items = pick(result.data);
  return items.length === 0
    ? { status: "empty", message: empty }
    : { status: "ready", data: items };
}

/** How many of today's events the hub lists (SPEC §3.1). */
export const HUB_EVENTS = 5;

/** An event on the hub: its time today and its title. */
export interface HubEvent {
  id: string;
  title: string;
  /** "19:00–20:30", "All day", "Until 11:00" or "From 22:00". */
  time: string;
  location: string | null;
}

function timeToday(e: CalendarEventView, today: string): string {
  if (e.allDay) return "All day";
  const starts = e.startDate === today;
  const ends = e.endDate === today;
  if (starts && ends) return `${e.startTime}–${e.endTime}`;
  if (starts) return `From ${e.startTime}`;
  if (ends) return `Until ${e.endTime}`;
  return "All day";
}

/**
 * Today's events that have not finished yet, soonest first, at most five.
 * `events` is `list_events` for today, which Google already sorts.
 */
export function upcomingEvents(
  events: CalendarEventView[],
  now: Date,
  limit = HUB_EVENTS,
): HubEvent[] {
  const today = berlinDateKey(now);
  return events
    .filter((e) =>
      e.allDay ? e.endDate >= today : Date.parse(e.end) > now.getTime(),
    )
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      title: e.title,
      time: timeToday(e, today),
      location: e.location,
    }));
}

/** How long a chore is due before the hub calls it overdue. */
export const OVERDUE_AFTER_MS = 24 * 60 * 60_000;

/** A chore on the hub: due now (or overdue), or falling due later today. */
export interface HubChore {
  id: string;
  name: string;
  /** "Due since Wed 30 Sep, 08:00", "Never done" or "Due at 18:00". */
  when: string;
  overdue: boolean;
  /** "Ryan · streak 3", or "No streak yet". */
  streak: string;
}

/**
 * The chores that are due, the longest-waiting first (never done at the
 * top), then those that fall due before Berlin midnight. A chore is overdue
 * once it has been due for a day.
 */
export function dueChores(chores: ChoreView[], now: Date): HubChore[] {
  const tomorrow = berlinDateTimeToUtc(
    addDaysToDateKey(berlinDateKey(now), 1),
  ).getTime();
  const due = chores
    .filter((c) => c.state === "due")
    .sort(
      (a, b) =>
        (a.dueAt ? Date.parse(a.dueAt) : -Infinity) -
          (b.dueAt ? Date.parse(b.dueAt) : -Infinity) ||
        a.name.localeCompare(b.name),
    )
    .map((c): HubChore => {
      const since = c.dueAt ? Date.parse(c.dueAt) : null;
      return {
        id: c.id,
        name: c.name,
        when:
          since === null
            ? "Never done"
            : `Due since ${formatBerlinDateTime(new Date(since))}`,
        overdue: since !== null && now.getTime() - since >= OVERDUE_AFTER_MS,
        streak: streakLabel(c),
      };
    });
  const later = chores
    .filter(
      (c) =>
        c.state !== "due" &&
        c.state !== "unavailable" &&
        c.dueAt !== null &&
        Date.parse(c.dueAt) < tomorrow,
    )
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
    .map((c): HubChore => ({
      id: c.id,
      name: c.name,
      when: `Due at ${berlinTimeKey(new Date(c.dueAt!))}`,
      overdue: false,
      streak: streakLabel(c),
    }));
  return [...due, ...later];
}

/** The clock's two lines, in Berlin time. */
export function clockLines(now: Date): { time: string; date: string } {
  return {
    time: berlinTimeKey(now),
    date: formatDateKey(berlinDateKey(now)),
  };
}
