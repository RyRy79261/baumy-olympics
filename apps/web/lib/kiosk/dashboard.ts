import {
  addDaysToDateKey,
  berlinDateKey,
  berlinTimeKey,
  dateKeyWeekday,
} from "@baumy/core";
import {
  isCalendarDate,
  type AvatarSprites,
  type ChoreKind,
} from "@baumy/types";
import { HOUSE_COLOUR } from "@baumy/ui";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { NoteView } from "@/lib/actions/notes";
import {
  eventsOnDay,
  viewRange,
  type CalendarEventView,
} from "@/lib/calendar/view";

// What the portrait kitchen dashboard shows (ADR 0005, issue #65). Pure and
// client-safe: the kiosk home reads list_chores, list_events and list_notes
// like every other surface, and these pick out the header's three counts,
// the bounty and message modules, and the month grid with its day sheet.
// Days and times are Berlin's (packages/core time.ts).

/** A member as the dashboard shows them: their character and colour. */
export interface DashboardMember {
  id: string;
  displayName: string;
  /** Their colour (`members.color`): chips, names and the initial tile. */
  color: string;
  /** Their gallery sprite (issue #111); without one, their initial tile. */
  sprites?: AvatarSprites | null;
}

/** The house's colour (the kit's `--color-bm-house`), which no member colour offered uses. */
export { HOUSE_COLOUR };

/** Who a calendar event or message is from, for its colour and name. */
export function whoOf(
  memberId: string | null,
  members: readonly DashboardMember[],
): { member: DashboardMember | null; name: string; colour: string } {
  const member = members.find((m) => m.id === memberId) ?? null;
  return member
    ? { member, name: member.displayName, colour: member.color }
    : { member: null, name: "House", colour: HOUSE_COLOUR };
}

// ---------------------------------------------------------------- header

const WEEKDAYS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Monday 28 September" for a Berlin day. */
export function longDay(day: string): string {
  const month = MONTHS_LONG[Number(day.slice(5, 7)) - 1]!;
  return `${WEEKDAYS_LONG[dateKeyWeekday(day) - 1]} ${Number(day.slice(8, 10))} ${month}`;
}

/** The header's two lines at `now`: "Monday 28 September" and "17:42". */
export function headerClock(now: Date): { date: string; time: string } {
  return { date: longDay(berlinDateKey(now)), time: berlinTimeKey(now) };
}

// ---------------------------------------------------------------- bounties

/** How soon a bounty is due, in words, and how loudly to say it. */
export interface DueLabel {
  text: string;
  /** late: red; soon (within 12 hours): amber; later: muted. */
  tone: "late" | "soon" | "later";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function dueLabel(
  c: Pick<ChoreView, "state" | "dueAt">,
  now: Date,
): DueLabel {
  // No weight yet: it cannot be logged, so it is not due either.
  if (c.state === "unavailable")
    return { text: "No points yet", tone: "later" };
  // Never done: available, but it has no rhythm to be late on yet, so it
  // is never urgent (SPEC §12 decision 22).
  if (c.dueAt === null) return { text: "Never done", tone: "later" };
  const left = Date.parse(c.dueAt) - now.getTime();
  if (c.state === "due" || left <= 0) {
    const late = -left;
    if (late < HOUR) return { text: "Due now", tone: "late" };
    const hours = Math.floor(late / HOUR);
    return hours < 48
      ? { text: `${hours}h late`, tone: "late" }
      : { text: `${Math.floor(hours / 24)}d late`, tone: "late" };
  }
  if (left < HOUR) {
    return {
      text: `in ${Math.max(1, Math.ceil(left / MINUTE))}m`,
      tone: "soon",
    };
  }
  const hours = Math.round(left / HOUR);
  if (hours <= 12) return { text: `in ${hours}h`, tone: "soon" };
  if (hours < 36) return { text: `in ${hours}h`, tone: "later" };
  return { text: `in ${Math.round(hours / 24)} days`, tone: "later" };
}

/** One bounty in the Urgent or New module. */
export interface BountyRowView {
  id: string;
  name: string;
  sprite: string;
  kind: ChoreKind;
  isNew: boolean;
  /** What logging it scores: yours once you tap in, else its base points. */
  points: number | null;
  due: DueLabel;
  /** The streak you would steal by doing it, if anyone holds one. */
  streak: {
    holderId: string;
    holderName: string;
    length: number;
    colour: string;
  } | null;
  /** It cannot be logged now: cooling down, or no weight yet. */
  loggable: boolean;
}

/**
 * When a bounty fell or falls due, for sorting. A chore never done has no
 * due time and is never urgent (SPEC §12 decision 22), so it is listed only
 * in the New module, where it sorts by when it was added. No weight yet
 * sorts last.
 */
export function dueAtMs(
  c: Pick<ChoreView, "state" | "dueAt" | "createdAt">,
): number {
  if (c.state === "unavailable") return Number.POSITIVE_INFINITY;
  return Date.parse(c.dueAt ?? c.createdAt);
}

/**
 * The chores a module lists as bounties, soonest due first. Archived chores
 * are never listed (list_chores leaves them out anyway).
 */
export function bountyRows(
  chores: readonly ChoreView[],
  pick: (c: ChoreView) => boolean,
  members: readonly DashboardMember[],
  now: Date,
): BountyRowView[] {
  return chores
    .filter((c) => !c.archived && pick(c))
    .sort((a, b) => dueAtMs(a) - dueAtMs(b) || a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      sprite: c.sprite,
      kind: c.kind,
      isNew: c.isNew,
      points: c.next?.totalPts ?? c.basePoints,
      due: dueLabel(c, now),
      streak: c.streak
        ? {
            ...c.streak,
            colour: whoOf(c.streak.holderId, members).colour,
          }
        : null,
      loggable: c.state === "due" || c.state === "done",
    }));
}

export const isUrgentBounty = (c: ChoreView) => c.urgent;
export const isNewBounty = (c: ChoreView) => c.isNew;

/** The module's tabs: every bounty, or one kind. */
export type BountyTab = "all" | ChoreKind;

export function bountyTabCounts(
  rows: readonly BountyRowView[],
): Record<BountyTab, number> {
  return {
    all: rows.length,
    consumable: rows.filter((r) => r.kind === "consumable").length,
    maintenance: rows.filter((r) => r.kind === "maintenance").length,
  };
}

export function inTab(row: BountyRowView, tab: BountyTab): boolean {
  return tab === "all" || row.kind === tab;
}

/** "Maintenance", "Consumable". */
export function kindLabel(kind: ChoreKind): string {
  return kind === "consumable" ? "Consumable" : "Maintenance";
}

// ---------------------------------------------------------------- messages

/** How far back the Messages icon looks (ADR 0005 §3): list_notes' NOTE_RECENT_MS. */
export const MESSAGES_WINDOW_MS = 24 * HOUR;

/** "now", "12m", "3h": how long ago, for a message's byline. */
export function agoLabel(at: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(at));
  if (ms < MINUTE) return "now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  return `${Math.floor(ms / HOUR)}h`;
}

/** One note in the Messages module. */
export interface MessageView {
  id: string;
  title: string;
  bodyMd: string;
  authorId: string;
  authorName: string;
  /** "12m ago", or "changed 2h ago" once edited. */
  when: string;
}

/**
 * The notes added, or whose words were edited, in the last 24 hours (ADR
 * 0005 §3), the newest first: the notes list_notes' `recentCount` counts,
 * so the icon's number and the module's list agree. Pinning is not an edit.
 */
export function recentMessages(
  notes: readonly NoteView[],
  now: Date,
): MessageView[] {
  const since = now.getTime() - MESSAGES_WINDOW_MS;
  return notes
    .filter((n) => Date.parse(n.editedAt) > since)
    .sort((a, b) => Date.parse(b.editedAt) - Date.parse(a.editedAt))
    .map((n) => {
      const edited = n.editedAt !== n.createdAt;
      const ago = agoLabel(n.editedAt, now);
      const when = ago === "now" ? "just now" : `${ago} ago`;
      return {
        id: n.id,
        title: n.title,
        bodyMd: n.bodyMd,
        authorId: n.authorId,
        authorName: n.authorName,
        when: edited ? `changed ${when}` : when,
      };
    });
}

// ---------------------------------------------------------------- month

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The month the home shows ("YYYY-MM", this month by default) and the day
 * whose sheet is open, from the page's search params. A day outside the
 * month's grid is ignored.
 */
export function parseMonthParams(
  params: { month?: string | string[]; day?: string | string[] },
  today: string,
): { month: string; day: string | null } {
  const m = one(params.month);
  const d = one(params.day);
  const month = m && MONTH_PARAM.test(m) ? m : today.slice(0, 7);
  const days = monthGridDays(month);
  const day =
    d && isCalendarDate(d) && days[0]! <= d && d <= days.at(-1)! ? d : null;
  return { month, day };
}

/** Every day in a month's grid: whole weeks, Monday first. */
export function monthGridDays(month: string): string[] {
  return viewRange("month", `${month}-01`).days;
}

/** "YYYY-MM" n months later (or earlier). */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const t = new Date(Date.UTC(y, m, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "SEPTEMBER 2026". */
export function monthTitle(month: string): string {
  return `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`.toUpperCase();
}

/** One day of the month grid. */
export interface MonthCellView {
  day: string;
  /** 1…31. */
  date: number;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  weekend: boolean;
  events: CalendarEventView[];
}

export function monthCells(
  month: string,
  today: string,
  events: readonly CalendarEventView[],
): MonthCellView[] {
  return monthGridDays(month).map((day) => ({
    day,
    date: Number(day.slice(8, 10)),
    inMonth: day.startsWith(month),
    today: day === today,
    past: day < today,
    weekend: dateKeyWeekday(day) >= 6,
    events: eventsOnDay(events, day),
  }));
}

// Cell geometry (px), shared by the grid and its "how many chips fit".
export const CELL_PAD = 6;
export const CELL_HEAD = 30;
export const CHIP_H = 28;
export const CHIP_GAP = 4;
export const GRID_GAP = 6;

/** How many chip rows fit in a cell `cellHeight` px tall (at least one). */
export function chipsThatFit(cellHeight: number): number {
  const room = cellHeight - CELL_PAD * 2 - CELL_HEAD;
  return Math.max(1, Math.floor((room + CHIP_GAP) / (CHIP_H + CHIP_GAP)));
}

/**
 * The chips a cell shows when `fit` rows fit: all of them, or one row fewer
 * and "+N more" in the last.
 */
export function chipsFor<T>(
  events: readonly T[],
  fit: number,
): { shown: T[]; more: number } {
  const shown =
    events.length > fit ? events.slice(0, Math.max(0, fit - 1)) : [...events];
  return { shown, more: events.length - shown.length };
}

/** The day sheet's heading: "Today" over "MONDAY 28 SEPTEMBER", and so on. */
export function dayHeading(
  day: string,
  today: string,
): { over: string; title: string } {
  const rel =
    day === today
      ? "Today"
      : day === addDaysToDateKey(today, 1)
        ? "Tomorrow"
        : day === addDaysToDateKey(today, -1)
          ? "Yesterday"
          : null;
  const [weekday, ...rest] = longDay(day).split(" ");
  return rel
    ? { over: rel, title: longDay(day).toUpperCase() }
    : { over: weekday!, title: rest.join(" ").toUpperCase() };
}

/** "5 things planned", with "· done and dusted" for a day gone by. */
export function plannedLabel(count: number, past: boolean): string {
  if (count === 0) return "";
  return `${count} ${count === 1 ? "thing" : "things"} planned${past ? " · done and dusted" : ""}`;
}

/** An event's time in the day sheet: "07:30" over "to 08:00". */
export function sheetTime(
  e: CalendarEventView,
  day: string,
): { start: string; end: string } {
  if (e.allDay) return { start: "All day", end: "" };
  const start = e.startDate === day ? e.startTime! : "00:00";
  if (e.endDate !== day) return { start, end: "till late" };
  return { start, end: `to ${e.endTime}` };
}
