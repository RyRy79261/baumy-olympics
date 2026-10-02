"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { formatDateKey } from "@baumy/core";
import {
  Button,
  CalendarDayCell,
  CalendarEventButton,
  CalendarGrid,
  Dialog,
  FormMessage,
  tabClass,
} from "@baumy/ui";
import {
  useActionForm,
  useReporting,
  type FormAction,
} from "@/components/use-action-form";
import type {
  CalendarWriteData,
  DeleteEventData,
} from "@/lib/actions/calendar";
import {
  CALENDAR_VIEWS,
  agendaDays,
  eventAccent,
  eventsOnDay,
  viewLabel,
  type CalendarEventView,
  type CalendarViewKind,
  type ViewRange,
} from "@/lib/calendar/view";
import type { DashboardMember } from "@/lib/kiosk/dashboard";
import { toast } from "@/lib/ui/toast";
import { EventDetails } from "./event-details";
import { EventForm } from "./event-form";

// The house calendar on a phone or a computer (/calendar, SPEC §3.3). Day,
// Week and Month views move by links, so the server reads each range from
// Google once. Tapping an event opens its sheet to edit it; deleting asks
// again in a dialog of its own before anything is sent. The kitchen screen
// has its own manager (components/kiosk/calendar-manager.tsx, issue #134),
// since its dashboard already shows the month.
//
// Layout only: the look is the pixel kit's (packages/ui, issue #64), laid
// out as the approved prototype's month grid (ADR 0005 §1): the title
// between ◀ and ▶, Today at the end, and each event chip in the colour of
// the member who added it (the house's otherwise).

export interface CalendarActions {
  create: FormAction<CalendarWriteData>;
  update: FormAction<CalendarWriteData>;
  remove: FormAction<DeleteEventData>;
}

type Sheet =
  { mode: "new"; date: string } | { mode: "edit"; event: CalendarEventView };

function href(view: CalendarViewKind, date: string): Route {
  return `/calendar?view=${view}&date=${date}` as Route;
}

/** What an event's button says about its time on one day. */
function timeOn(e: CalendarEventView, day: string): string {
  if (e.allDay) return "All day";
  if (e.startDate === day) return e.startTime!;
  if (e.endDate === day) return `Until ${e.endTime}`;
  return "All day";
}

export function CalendarBoard({
  range,
  events,
  today,
  people,
  memberColors = {},
  actions,
}: {
  range: ViewRange;
  events: CalendarEventView[];
  /** Today in Berlin, "YYYY-MM-DD". */
  today: string;
  /** The house's active members: who an event is for, and "Added by". */
  people: readonly DashboardMember[];
  /** Member id → colour (`#rrggbb`), for the event chips. */
  memberColors?: Record<string, string>;
  actions: CalendarActions;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [deleting, setDeleting] = useState<CalendarEventView | null>(null);
  const phoneAgenda = range.view === "month";
  const newDate =
    range.view === "day"
      ? range.date
      : range.from <= today && today <= range.to
        ? today
        : range.from;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Calendar view" className="flex gap-2">
          {CALENDAR_VIEWS.map((v) => (
            <Link
              key={v}
              href={href(v, range.date)}
              className={tabClass(v === range.view, "violet")}
              aria-current={v === range.view ? "page" : undefined}
            >
              {viewLabel(v)}
            </Link>
          ))}
        </nav>
        <Button onClick={() => setSheet({ mode: "new", date: newDate })}>
          New event
        </Button>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href={href(range.view, range.prev)}
          aria-label="Previous"
          className={tabClass(false, "violet") + " px-4 text-bm-text"}
        >
          <span aria-hidden="true">◀</span>
        </Link>
        <h2
          className="min-w-0 flex-1 text-center font-display text-sm leading-snug text-bm-text sm:text-lg"
          data-testid="calendar-title"
        >
          {range.title}
        </h2>
        <Link
          href={href(range.view, range.next)}
          aria-label="Next"
          className={tabClass(false, "violet") + " px-4 text-bm-text"}
        >
          <span aria-hidden="true">▶</span>
        </Link>
        <Link
          href={href(range.view, today)}
          className={tabClass(false, "violet")}
        >
          Today
        </Link>
      </div>

      {/* The month on a phone is an agenda (below); the grid is for sm up. */}
      <div className={phoneAgenda ? "max-sm:hidden" : undefined}>
        <CalendarGrid
          columns={range.view === "day" ? 1 : 7}
          weekdays={range.view === "month"}
          label={range.title}
        >
          {range.days.map((day) => (
            <CalendarDayCell
              key={day}
              data-testid={`day-${day}`}
              label={formatDateKey(day)}
              shortLabel={
                range.view === "month"
                  ? String(Number(day.slice(8)))
                  : undefined
              }
              today={day === today}
              muted={range.month !== null && !day.startsWith(range.month)}
              tall={range.view !== "month"}
            >
              {eventsOnDay(events, day).map((e) => (
                <CalendarEventButton
                  key={e.id}
                  title={e.title}
                  time={timeOn(e, day)}
                  accent={eventAccent(e, memberColors)}
                  aria-label={`${e.title}, ${e.when}`}
                  onClick={() => setSheet({ mode: "edit", event: e })}
                />
              ))}
            </CalendarDayCell>
          ))}
        </CalendarGrid>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-bm-muted">
            Nothing on the calendar here.
          </p>
        ) : null}
      </div>

      {phoneAgenda ? (
        <ol
          aria-label={`${range.title}, day by day`}
          data-testid="month-agenda"
          className="flex flex-col gap-5 sm:hidden"
        >
          {agendaDays(range, events, today).map((day) => {
            const onDay = eventsOnDay(events, day);
            return (
              <li
                key={day}
                data-testid={`agenda-${day}`}
                className="flex flex-col gap-1.5"
              >
                <h3 className="font-label text-sm font-bold tracking-wide text-bm-muted uppercase">
                  {day === today
                    ? `Today · ${formatDateKey(day)}`
                    : formatDateKey(day)}
                </h3>
                {onDay.length > 0 ? (
                  onDay.map((e) => (
                    <CalendarEventButton
                      key={e.id}
                      title={e.title}
                      time={timeOn(e, day)}
                      accent={eventAccent(e, memberColors)}
                      aria-label={`${e.title}, ${e.when}`}
                      onClick={() => setSheet({ mode: "edit", event: e })}
                    />
                  ))
                ) : (
                  <p className="text-base text-bm-dim">Nothing planned.</p>
                )}
              </li>
            );
          })}
          {agendaDays(range, events, today).length === 0 ? (
            <li className="text-base text-bm-muted">
              Nothing on the calendar this month.
            </li>
          ) : null}
        </ol>
      ) : null}

      <Dialog
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={
          sheet?.mode === "edit" ? `Edit ${sheet.event.title}` : "New event"
        }
      >
        {sheet ? (
          <div className="flex flex-col gap-4">
            {sheet.mode === "edit" ? (
              <EventDetails event={sheet.event} people={people} />
            ) : null}
            <EventForm
              key={sheet.mode === "edit" ? sheet.event.id : sheet.date}
              event={sheet.mode === "edit" ? sheet.event : null}
              date={sheet.mode === "new" ? sheet.date : today}
              kiosk={false}
              pinLabel="Your PIN"
              people={people}
              action={sheet.mode === "edit" ? actions.update : actions.create}
              onDone={(data) => {
                setSheet(null);
                toast.success(
                  sheet.mode === "edit"
                    ? `Saved ${data.event.title}.`
                    : `Added ${data.event.title} to the calendar.`,
                );
              }}
              onCancel={() => setSheet(null)}
            />
            {sheet.mode === "edit" ? (
              <Button
                variant="danger"
                onClick={() => {
                  setDeleting(sheet.event);
                  setSheet(null);
                }}
              >
                Delete…
              </Button>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.title}?` : "Delete the event?"}
      >
        {deleting ? (
          <DeleteForm
            key={deleting.id}
            event={deleting}
            action={actions.remove}
            onDone={(data) => {
              setDeleting(null);
              toast.success(`Deleted ${data.title}.`);
            }}
            onCancel={() => setDeleting(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function DeleteForm({
  event,
  action,
  onDone,
  onCancel,
}: {
  event: CalendarEventView;
  action: FormAction<DeleteEventData>;
  onDone: (data: DeleteEventData) => void;
  onCancel: () => void;
}) {
  const { state, formAction, pending, requestId } = useActionForm(
    useReporting(action, onDone),
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="eventId" value={event.id} />
      <p className="text-sm">
        {event.when}. This takes it off the house calendar in Google for
        everyone.
      </p>
      {state && !state.ok ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Deleting..." : "Delete event"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
