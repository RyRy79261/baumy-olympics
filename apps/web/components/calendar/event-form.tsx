"use client";

import { useState } from "react";
import {
  Button,
  ChoiceGroup,
  Dialog,
  Field,
  FormMessage,
  Input,
  MemberCharacter,
  PinPad,
  Swatch,
  Textarea,
  TilePicker,
} from "@baumy/ui";
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_TITLE_MAX,
} from "@baumy/types";
import {
  useActionForm,
  useReporting,
  type FormAction,
} from "@/components/use-action-form";
import { useReportPending } from "@/components/use-report-pending";
import type { CalendarWriteData } from "@/lib/actions/calendar";
import { FOR_EVERYONE, type CalendarEventView } from "@/lib/calendar/view";
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";
import { HOUSE_COLOUR, type DashboardMember } from "@/lib/kiosk/dashboard";

// Add or change a house calendar event (SPEC §3.3), on the phone (/calendar)
// and on the kitchen screen (/kiosk/calendar). It says who the event is for
// (issue #134): one member, by their character, or the whole house.
//
// The writes need no PIN on the kiosk (owner ruling 2026-10-02, issue
// #145). The form stays an AttestedForm: if a gate ever asks for one, the
// pad opens inside this form and its OK sends the same fields again with
// the PIN. The fields are controlled: React resets a form's uncontrolled
// fields after each action, and a PIN prompt sends them twice.

/** The "for" value that means the whole house (null, once it arrives). */
const HOUSE = FOR_EVERYONE;

export function EventForm({
  event,
  date,
  kiosk,
  pinLabel,
  people,
  action,
  onDone,
  onCancel,
  onPending,
}: {
  /** The event to change, or null to add one. */
  event: CalendarEventView | null;
  /** A new event's first day. */
  date: string;
  kiosk: boolean;
  /** What the PIN pad is for, e.g. "Ryan's PIN". */
  pinLabel: string;
  /** Who it can be for: the house's active members. */
  people: readonly DashboardMember[];
  action: FormAction<CalendarWriteData>;
  onDone: (data: CalendarWriteData) => void;
  onCancel: () => void;
  /** Told while a save is on its way (the sheet stays open, #174). */
  onPending?: (pending: boolean) => void;
}) {
  const e = event;
  const { state, formAction, pending, requestId, errors } = useActionForm(
    useReporting(action, onDone),
  );
  useReportPending(pending, onPending);
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [title, setTitle] = useState(e?.title ?? "");
  const [kind, setKind] = useState<"timed" | "all_day">(
    e?.allDay ? "all_day" : "timed",
  );
  const [first, setFirst] = useState(e?.startDate ?? date);
  const [last, setLast] = useState(
    e && e.endDate !== e.startDate ? e.endDate : "",
  );
  const [startTime, setStartTime] = useState(e?.startTime ?? "19:00");
  const [endTime, setEndTime] = useState(e?.endTime ?? "20:00");
  const [location, setLocation] = useState(e?.location ?? "");
  const [description, setDescription] = useState(e?.description ?? "");
  // Someone who has left the house shows as the house: they cannot be picked.
  const [forMember, setForMember] = useState(
    e?.forMember && people.some((p) => p.id === e.forMember)
      ? e.forMember
      : HOUSE,
  );
  const size = kiosk ? "kiosk" : "default";
  const id = e ? `event-${e.id}` : "event-new";
  const failed = state && !state.ok ? state : null;
  const needsPin = failed !== null && PIN_PROMPT_CODES.has(failed.code);
  const pinOpen = needsPin && !dismissed;
  return (
    <form
      action={(form) => {
        setDismissed(false);
        setAttempt((n) => n + 1);
        formAction(form);
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      {e ? <input type="hidden" name="eventId" value={e.id} /> : null}
      <Field id={`${id}-title`} label="Title" errors={errors.title}>
        {(c) => (
          <Input
            {...c}
            name="title"
            kiosk={kiosk}
            maxLength={EVENT_TITLE_MAX}
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            required
          />
        )}
      </Field>
      <TilePicker
        legend="Who is it for?"
        name="forMemberId"
        kiosk={kiosk}
        captions
        value={forMember}
        onChange={setForMember}
        testId="event-for"
        options={[
          {
            value: HOUSE,
            label: "Everyone",
            tile: <Swatch colour={HOUSE_COLOUR} kiosk={kiosk} />,
          },
          ...people.map((p) => ({
            value: p.id,
            label: p.displayName,
            tile: (
              <MemberCharacter
                sprites={p.sprites}
                name={p.displayName}
                colour={p.color}
                scale={2}
              />
            ),
          })),
        ]}
      />
      {errors.forMemberId ? (
        <FormMessage tone="error">{errors.forMemberId.join(" ")}</FormMessage>
      ) : null}
      <ChoiceGroup
        legend="When"
        name="kind"
        kiosk={kiosk}
        value={kind}
        onChange={(v) => setKind(v as "timed" | "all_day")}
        options={[
          { value: "timed", label: "At a time" },
          { value: "all_day", label: "All day" },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-date`} label="Date" errors={errors.date}>
          {(c) => (
            <Input
              {...c}
              name="date"
              type="date"
              kiosk={kiosk}
              value={first}
              onChange={(ev) => setFirst(ev.target.value)}
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
              value={last}
              onChange={(ev) => setLast(ev.target.value)}
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
                value={startTime}
                onChange={(ev) => setStartTime(ev.target.value)}
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
                value={endTime}
                onChange={(ev) => setEndTime(ev.target.value)}
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
            value={location}
            onChange={(ev) => setLocation(ev.target.value)}
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
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
          />
        )}
      </Field>
      <p className="text-sm text-bm-muted">Times are Berlin time.</p>
      {failed && !needsPin && failed.code !== "INVALID_INPUT" ? (
        <FormMessage tone="error">{failed.message}</FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size={size} disabled={pending}>
          {pending ? "Saving..." : e ? "Save" : "Add event"}
        </Button>
        <Button
          variant="secondary"
          size={size}
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      <Dialog
        open={pinOpen}
        onClose={() => setDismissed(true)}
        busy={pending}
        title={pinLabel}
      >
        <div className="flex flex-col gap-4">
          {failed && failed.code !== "ATTESTATION_REQUIRED" ? (
            <FormMessage tone="error">{failed.message}</FormMessage>
          ) : null}
          {pinOpen ? (
            <PinPad
              key={attempt}
              label={pinLabel}
              submitLabel="OK"
              pending={pending}
              onCancel={() => setDismissed(true)}
            />
          ) : null}
        </div>
      </Dialog>
    </form>
  );
}
