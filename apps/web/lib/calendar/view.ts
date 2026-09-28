import {
  addDaysToDateKey,
  berlinDateKey,
  berlinTimeKey,
  dateKeyWeekday,
  formatDateKey,
  formatMonthKey,
} from "@baumy/core";
import { isCalendarDate } from "@baumy/types";

// What the house calendar shows (SPEC §3.3). Pure and client-safe: the
// actions build `CalendarEventView`s with it, and /calendar and the kiosk lay
// them out in Day, Week and Month views. Days are Berlin days, "YYYY-MM-DD".

/** An event as the actions return it and the pages show it. */
export interface CalendarEventView {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** All-day: the first day. Timed: an ISO instant (UTC). */
  start: string;
  /** All-day: the day after the last (Google's exclusive end). Timed: an ISO instant. */
  end: string;
  /** The first Berlin day. */
  startDate: string;
  /** The last Berlin day it touches, inclusive. */
  endDate: string;
  /** Timed: Berlin wall-clock "HH:MM"; null for all-day. */
  startTime: string | null;
  endTime: string | null;
  /** For people: "Fri 15 Jan, 19:00–20:30" or "Fri 15 Jan, all day". */
  when: string;
  /** The member who added it in the app, or null. */
  addedBy: string | null;
}

/** The fields of a calendar event this needs (the adapter's CalendarEvent). */
export interface EventLike {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  start: string;
  end: string;
  member: string | null;
}

/** How long an event is on the calendar, for people. */
export function whenLabel(
  v: Pick<
    CalendarEventView,
    "allDay" | "startDate" | "endDate" | "startTime" | "endTime"
  >,
): string {
  const first = formatDateKey(v.startDate);
  if (v.allDay) {
    return v.startDate === v.endDate
      ? `${first}, all day`
      : `${first} – ${formatDateKey(v.endDate)}, all day`;
  }
  if (v.startDate === v.endDate) {
    return `${first}, ${v.startTime}–${v.endTime}`;
  }
  return `${first}, ${v.startTime} – ${formatDateKey(v.endDate)}, ${v.endTime}`;
}

/** An adapter event as the pages show it, in Berlin days and times. */
export function eventView(e: EventLike): CalendarEventView {
  let startDate: string;
  let endDate: string;
  let startTime: string | null = null;
  let endTime: string | null = null;
  if (e.allDay) {
    startDate = e.start;
    endDate = addDaysToDateKey(e.end, -1);
    if (endDate < startDate) endDate = startDate;
  } else {
    const s = new Date(e.start);
    const end = new Date(e.end);
    startDate = berlinDateKey(s);
    endDate = berlinDateKey(end);
    startTime = berlinTimeKey(s);
    endTime = berlinTimeKey(end);
  }
  const base = { allDay: e.allDay, startDate, endDate, startTime, endTime };
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    start: e.start,
    end: e.end,
    ...base,
    when: whenLabel(base),
    addedBy: e.member,
  };
}

/**
 * Whether an event shows on a day. A timed event that ends at 00:00 does not
 * show on the day it ends.
 */
export function isOnDay(e: CalendarEventView, day: string): boolean {
  let last = e.endDate;
  if (!e.allDay && e.endTime === "00:00" && e.endDate > e.startDate) {
    last = addDaysToDateKey(e.endDate, -1);
  }
  return e.startDate <= day && day <= last;
}

/** The events on one day: all-day ones first, then by start. */
export function eventsOnDay(
  events: readonly CalendarEventView[],
  day: string,
): CalendarEventView[] {
  return events
    .filter((e) => isOnDay(e, day))
    .sort((a, b) =>
      a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start < b.start ? -1 : 1,
    );
}

/**
 * The month view on a phone, as an agenda: today first (when it is in the
 * month), then only the later days that have events; for another month,
 * every day of it that has events. The days of the next month that close
 * the grid's last week are in too (an event on 2 Oct shows on 28 Sep, as
 * the grid would show it); the previous month's opening days are not. The
 * stacked grid of 35 empty boxes put today three screens down.
 */
export function agendaDays(
  range: Pick<ViewRange, "days" | "month">,
  events: readonly CalendarEventView[],
  today: string,
): string[] {
  const days = range.days.filter(
    (d) => range.month === null || d >= `${range.month}-01`,
  );
  const busy = (d: string) => eventsOnDay(events, d).length > 0;
  return days.includes(today)
    ? [today, ...days.filter((d) => d > today && busy(d))]
    : days.filter(busy);
}

/** How many chips a kitchen-screen month cell shows before "+N more". */
export const KIOSK_MONTH_CHIPS = 3;

export const CALENDAR_VIEWS = ["day", "week", "month"] as const;
export type CalendarViewKind = (typeof CALENDAR_VIEWS)[number];

export interface ViewRange {
  view: CalendarViewKind;
  /** The day the view is anchored on. */
  date: string;
  /** Every day shown, first to last. */
  days: string[];
  from: string;
  to: string;
  /** The anchors of the view before and after. */
  prev: string;
  next: string;
  title: string;
  /** Month view: the month's days, "YYYY-MM"; the edge weeks show greyed. */
  month: string | null;
}

/** Monday of the week a day is in. */
function mondayOf(day: string): string {
  return addDaysToDateKey(day, 1 - dateKeyWeekday(day));
}

function span(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateKey(d, 1)) out.push(d);
  return out;
}

function withYear(day: string): string {
  return `${formatDateKey(day)} ${day.slice(0, 4)}`;
}

/** What a view anchored on `date` shows. */
export function viewRange(view: CalendarViewKind, date: string): ViewRange {
  if (view === "day") {
    return {
      view,
      date,
      days: [date],
      from: date,
      to: date,
      prev: addDaysToDateKey(date, -1),
      next: addDaysToDateKey(date, 1),
      title: withYear(date),
      month: null,
    };
  }
  if (view === "week") {
    const from = mondayOf(date);
    const to = addDaysToDateKey(from, 6);
    return {
      view,
      date,
      days: span(from, to),
      from,
      to,
      prev: addDaysToDateKey(date, -7),
      next: addDaysToDateKey(date, 7),
      title: `${formatDateKey(from)} – ${withYear(to)}`,
      month: null,
    };
  }
  const month = date.slice(0, 7);
  const first = `${month}-01`;
  const nextFirst = addDaysToDateKey(first, 32).slice(0, 7) + "-01";
  const last = addDaysToDateKey(nextFirst, -1);
  const from = mondayOf(first);
  const to = addDaysToDateKey(mondayOf(last), 6);
  return {
    view,
    date,
    days: span(from, to),
    from,
    to,
    prev: addDaysToDateKey(first, -1).slice(0, 7) + "-01",
    next: nextFirst,
    title: formatMonthKey(month),
    month,
  };
}

/** The view and day from a page's search params, else the week of today. */
export function parseViewParams(
  params: { view?: string | string[]; date?: string | string[] },
  today: string,
): { view: CalendarViewKind; date: string } {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const view = one(params.view);
  const date = one(params.date);
  return {
    view: CALENDAR_VIEWS.includes(view as CalendarViewKind)
      ? (view as CalendarViewKind)
      : "week",
    date: date && isCalendarDate(date) ? date : today,
  };
}

/**
 * The chip colour of an event nobody in the app added: the house's, a
 * neutral grey, since amber already means consumable (ADR 0005 §8) and
 * members' own colours include oranges.
 */
export const HOUSE_EVENT_ACCENT = "var(--color-bm-muted)";

/**
 * An event chip's colour (the prototype's month grid): the colour of the
 * member who added it, or the house's grey for everything else (added in
 * Google, or by a member who has left). Only a `#rrggbb` is trusted into a
 * style.
 */
export function eventAccent(
  e: Pick<CalendarEventView, "addedBy">,
  memberColors: Record<string, string>,
): string {
  const color = e.addedBy ? memberColors[e.addedBy] : undefined;
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : HOUSE_EVENT_ACCENT;
}

/** The label of a view switch. */
export function viewLabel(view: CalendarViewKind): string {
  return view === "day" ? "Day" : view === "week" ? "Week" : "Month";
}
