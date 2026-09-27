"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRef, useState } from "react";
import { formatDateKey } from "@baumy/core";
import {
  Button,
  CalendarDayCell,
  CalendarEventButton,
  CalendarGrid,
  Dialog,
  Field,
  FormMessage,
  Input,
  Select,
  Textarea,
  buttonClass,
  navItemClass,
} from "@baumy/ui";
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_TITLE_MAX,
} from "@baumy/types";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type {
  CalendarWriteData,
  DeleteEventData,
} from "@/lib/actions/calendar";
import {
  CALENDAR_VIEWS,
  eventsOnDay,
  viewLabel,
  type CalendarEventView,
  type CalendarViewKind,
  type ViewRange,
} from "@/lib/calendar/view";
import { toast } from "@/lib/ui/toast";

// The house calendar (SPEC §3.3), the same on the phone (/calendar) and on
// the kiosk (/kiosk/calendar, acting as the member whose avatar was tapped).
// Day, Week and Month views move by links, so the server reads each range
// from Google once. Tapping an event opens its sheet to edit it; deleting
// asks again in a dialog of its own before anything is sent.
//
// NEUTRAL PLACEHOLDER layout; issue #7 restyles it through packages/ui.

export interface CalendarActions {
  create: FormAction<CalendarWriteData>;
  update: FormAction<CalendarWriteData>;
  remove: FormAction<DeleteEventData>;
}

type Sheet =
  { mode: "new"; date: string } | { mode: "edit"; event: CalendarEventView };

function href(basePath: string, view: CalendarViewKind, date: string): Route {
  return `${basePath}?view=${view}&date=${date}` as Route;
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
  basePath,
  kiosk = false,
  memberNames,
  actions,
}: {
  range: ViewRange;
  events: CalendarEventView[];
  /** Today in Berlin, "YYYY-MM-DD". */
  today: string;
  basePath: "/calendar" | "/kiosk/calendar";
  kiosk?: boolean;
  /** Member id → display name, for "Added by". */
  memberNames: Record<string, string>;
  actions: CalendarActions;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [deleting, setDeleting] = useState<CalendarEventView | null>(null);
  const size = kiosk ? "kiosk" : "default";
  const newDate =
    range.view === "day"
      ? range.date
      : range.from <= today && today <= range.to
        ? today
        : range.from;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Calendar view" className="flex gap-1">
          {CALENDAR_VIEWS.map((v) => (
            <Link
              key={v}
              href={href(basePath, v, range.date)}
              className={navItemClass(v === range.view)}
              aria-current={v === range.view ? "page" : undefined}
            >
              {viewLabel(v)}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href(basePath, range.view, range.prev)}
            className={buttonClass("secondary", size)}
          >
            Previous
          </Link>
          <Link
            href={href(basePath, range.view, today)}
            className={buttonClass("secondary", size)}
          >
            Today
          </Link>
          <Link
            href={href(basePath, range.view, range.next)}
            className={buttonClass("secondary", size)}
          >
            Next
          </Link>
          <Button
            size={size}
            onClick={() => setSheet({ mode: "new", date: newDate })}
          >
            New event
          </Button>
        </div>
      </div>
      <h2 className="text-lg font-semibold" data-testid="calendar-title">
        {range.title}
      </h2>

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
            today={day === today}
            muted={range.month !== null && !day.startsWith(range.month)}
            tall={range.view !== "month"}
          >
            {eventsOnDay(events, day).map((e) => (
              <CalendarEventButton
                key={e.id}
                title={e.title}
                time={timeOn(e, day)}
                kiosk={kiosk}
                aria-label={`${e.title}, ${e.when}`}
                onClick={() => setSheet({ mode: "edit", event: e })}
              />
            ))}
          </CalendarDayCell>
        ))}
      </CalendarGrid>
      {events.length === 0 ? (
        <p className="text-sm text-neutral-600">
          Nothing on the calendar here.
        </p>
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
              <EventDetails event={sheet.event} memberNames={memberNames} />
            ) : null}
            <EventForm
              key={sheet.mode === "edit" ? sheet.event.id : sheet.date}
              sheet={sheet}
              kiosk={kiosk}
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
                size={size}
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
            kiosk={kiosk}
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

function EventDetails({
  event,
  memberNames,
}: {
  event: CalendarEventView;
  memberNames: Record<string, string>;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-neutral-600">When</dt>
      <dd data-testid="event-when">{event.when}</dd>
      {event.location ? (
        <>
          <dt className="text-neutral-600">Where</dt>
          <dd>{event.location}</dd>
        </>
      ) : null}
      {event.addedBy ? (
        <>
          <dt className="text-neutral-600">Added by</dt>
          <dd data-testid="event-added-by">
            {memberNames[event.addedBy] ?? "a former member"}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * The action, then `onDone` on success. Read through a ref, so the form's
 * action never goes stale and the sheet can close before it re-renders.
 */
function useReporting<T>(action: FormAction<T>, onDone: (data: T) => void) {
  const done = useRef(onDone);
  done.current = onDone;
  const [wrapped] = useState<FormAction<T>>(() => {
    const send: FormAction<T> = async (prev, form) => {
      const result = await action(prev, form);
      if (result.ok) done.current(result.data);
      return result;
    };
    return send;
  });
  return wrapped;
}

function EventForm({
  sheet,
  kiosk,
  action,
  onDone,
  onCancel,
}: {
  sheet: Sheet;
  kiosk: boolean;
  action: FormAction<CalendarWriteData>;
  onDone: (data: CalendarWriteData) => void;
  onCancel: () => void;
}) {
  const e = sheet.mode === "edit" ? sheet.event : null;
  const { state, formAction, pending, requestId, errors } = useActionForm(
    useReporting(action, onDone),
  );
  const [kind, setKind] = useState<"timed" | "all_day">(
    e?.allDay ? "all_day" : "timed",
  );
  const size = kiosk ? "kiosk" : "default";
  const id = e ? `event-${e.id}` : "event-new";
  const date = e?.startDate ?? (sheet.mode === "new" ? sheet.date : "");
  const endDate = e && e.endDate !== e.startDate ? e.endDate : undefined;
  const control = kiosk ? "min-h-14 text-lg" : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      {e ? <input type="hidden" name="eventId" value={e.id} /> : null}
      <Field id={`${id}-title`} label="Title" errors={errors.title}>
        {(c) => (
          <Input
            {...c}
            name="title"
            kiosk={kiosk}
            maxLength={EVENT_TITLE_MAX}
            defaultValue={e?.title}
            required
          />
        )}
      </Field>
      <Field id={`${id}-kind`} label="When" errors={errors.kind}>
        {(c) => (
          <Select
            {...c}
            name="kind"
            className={control}
            value={kind}
            onChange={(ev) => setKind(ev.target.value as "timed" | "all_day")}
          >
            <option value="timed">At a time</option>
            <option value="all_day">All day</option>
          </Select>
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-date`} label="Date" errors={errors.date}>
          {(c) => (
            <Input
              {...c}
              name="date"
              type="date"
              kiosk={kiosk}
              defaultValue={date}
              required
            />
          )}
        </Field>
        <Field
          id={`${id}-end-date`}
          label="Last day"
          hint="Only if it goes on past the first day."
          errors={errors.endDate}
        >
          {(c) => (
            <Input
              {...c}
              name="endDate"
              type="date"
              kiosk={kiosk}
              defaultValue={endDate}
            />
          )}
        </Field>
      </div>
      {kind === "timed" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-start`} label="Starts" errors={errors.startTime}>
            {(c) => (
              <Input
                {...c}
                name="startTime"
                type="time"
                kiosk={kiosk}
                defaultValue={e?.startTime ?? "19:00"}
                required
              />
            )}
          </Field>
          <Field id={`${id}-end`} label="Ends" errors={errors.endTime}>
            {(c) => (
              <Input
                {...c}
                name="endTime"
                type="time"
                kiosk={kiosk}
                defaultValue={e?.endTime ?? "20:00"}
                required
              />
            )}
          </Field>
        </div>
      ) : null}
      <Field id={`${id}-location`} label="Where" errors={errors.location}>
        {(c) => (
          <Input
            {...c}
            name="location"
            kiosk={kiosk}
            maxLength={EVENT_LOCATION_MAX}
            defaultValue={e?.location ?? undefined}
          />
        )}
      </Field>
      <Field id={`${id}-notes`} label="Notes" errors={errors.description}>
        {(c) => (
          <Textarea
            {...c}
            name="description"
            kiosk={kiosk}
            maxLength={EVENT_DESCRIPTION_MAX}
            defaultValue={e?.description ?? undefined}
          />
        )}
      </Field>
      <p className="text-sm text-neutral-600">Times are Berlin time.</p>
      {state && !state.ok && state.code !== "INVALID_INPUT" ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size={size} disabled={pending}>
          {pending ? "Saving..." : e ? "Save" : "Add event"}
        </Button>
        <Button variant="secondary" size={size} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteForm({
  event,
  kiosk,
  action,
  onDone,
  onCancel,
}: {
  event: CalendarEventView;
  kiosk: boolean;
  action: FormAction<DeleteEventData>;
  onDone: (data: DeleteEventData) => void;
  onCancel: () => void;
}) {
  const { state, formAction, pending, requestId } = useActionForm(
    useReporting(action, onDone),
  );
  const size = kiosk ? "kiosk" : "default";
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
        <Button type="submit" variant="danger" size={size} disabled={pending}>
          {pending ? "Deleting..." : "Delete event"}
        </Button>
        <Button variant="secondary" size={size} onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
