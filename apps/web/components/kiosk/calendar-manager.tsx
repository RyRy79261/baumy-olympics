"use client";

import { useState } from "react";
import {
  Button,
  DayEventRow,
  Dialog,
  MemberCharacter,
  SectionHeading,
  WhoLine,
} from "@baumy/ui";
import { EventDetails, forName } from "@/components/calendar/event-details";
import { EventForm } from "@/components/calendar/event-form";
import type { CalendarActions } from "@/components/calendar/calendar-board";
import { AttestedForm } from "@/components/kiosk/attested-form";
import { upcomingTime, type UpcomingGroup } from "@/lib/calendar/upcoming";
import type { CalendarEventView } from "@/lib/calendar/view";
import { HOUSE_COLOUR, type DashboardMember } from "@/lib/kiosk/dashboard";
import { toast, toastActionError } from "@/lib/ui/toast";

// The kitchen screen's Calendar tab (issue #134): not another view of the
// month (the dashboard at /kiosk shows that), but a manager. What is still
// to come is a list in Today, This week and Later, each event with who it
// is for; a big "Add event" opens the form, and tapping an event opens it to
// change or delete. Every change runs create_event, update_event or
// delete_event as the member acting, with no PIN (owner ruling 2026-10-02,
// issue #145).
//
// Layout only, from the kit: the day sheet's event rows (DayEventRow,
// WhoLine), the members' characters, buttons and dialogs. Nothing is drawn
// here.

type Sheet = { mode: "new" } | { mode: "edit"; event: CalendarEventView };

/**
 * Who an event is for, as its row shows them: the member in their colour
 * with their character, or the house's colour for everyone (and for a
 * member who has left).
 */
function whoFor(
  e: CalendarEventView,
  people: readonly DashboardMember[],
): { member: DashboardMember | null; name: string; colour: string } {
  const member = people.find((p) => p.id === e.forMember) ?? null;
  return member
    ? { member, name: member.displayName, colour: member.color }
    : {
        member: null,
        name: forName(e.forMember, people),
        colour: HOUSE_COLOUR,
      };
}

export function CalendarManager({
  groups,
  today,
  people,
  canEdit,
  pinLabel,
  actions,
}: {
  groups: UpcomingGroup[];
  /** Today in Berlin, "YYYY-MM-DD". */
  today: string;
  /** The house's active members. */
  people: readonly DashboardMember[];
  /** False until someone taps their avatar. */
  canEdit: boolean;
  /** What the PIN pad is for, e.g. "Ryan's PIN". */
  pinLabel: string;
  actions: CalendarActions;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [deleting, setDeleting] = useState<CalendarEventView | null>(null);
  // A save or a delete on its way: its sheet stays open for the answer.
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      {canEdit ? (
        <Button
          size="kiosk"
          className="min-h-16 w-full text-lg"
          onClick={() => setSheet({ mode: "new" })}
        >
          Add event
        </Button>
      ) : null}

      {groups.map((g) => (
        <section
          key={g.key}
          aria-labelledby={`upcoming-${g.key}`}
          data-testid={`upcoming-${g.key}`}
        >
          <SectionHeading id={`upcoming-${g.key}`}>
            {g.title}
            {g.events.length > 0 ? ` · ${g.events.length}` : ""}
          </SectionHeading>
          {g.events.length === 0 ? (
            <p className="text-lg text-bm-dim">{g.empty}</p>
          ) : (
            <ul className="pixel-frame bg-bm-raised px-5 [--pf:var(--color-bm-line)]">
              {g.events.map((e) => {
                const who = whoFor(e, people);
                const time = upcomingTime(e, g.key, today);
                const row = (
                  <DayEventRow
                    start={time.start}
                    end={time.end}
                    colour={who.colour}
                    title={e.title}
                    who={
                      <WhoLine
                        name={who.name}
                        colour={who.colour}
                        who={
                          who.member ? (
                            <MemberCharacter
                              sprites={who.member.sprites}
                              name={who.name}
                              colour={who.colour}
                              scale={2}
                            />
                          ) : undefined
                        }
                      />
                    }
                  />
                );
                return (
                  <li
                    key={e.id}
                    data-testid={`upcoming-event-${e.id}`}
                    className="border-t-2 border-bm-line first:border-t-0"
                  >
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`${e.title}, ${e.when}`}
                        className="block min-h-14 w-full text-left active:translate-y-px"
                        onClick={() => setSheet({ mode: "edit", event: e })}
                      >
                        {row}
                      </button>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      <Dialog
        open={sheet !== null}
        onClose={() => setSheet(null)}
        busy={saving}
        title={
          sheet?.mode === "edit" ? `Edit ${sheet.event.title}` : "New event"
        }
      >
        {sheet ? (
          <div className="flex flex-col gap-4">
            {sheet.mode === "edit" ? (
              <EventDetails event={sheet.event} people={people} kiosk />
            ) : null}
            <EventForm
              key={sheet.mode === "edit" ? sheet.event.id : "new"}
              event={sheet.mode === "edit" ? sheet.event : null}
              date={today}
              kiosk
              pinLabel={pinLabel}
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
              onPending={setSaving}
            />
            {sheet.mode === "edit" ? (
              <Button
                variant="danger"
                size="kiosk"
                disabled={saving}
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
        busy={removing}
        title={deleting ? `Delete ${deleting.title}?` : "Delete the event?"}
      >
        {deleting ? (
          <div className="flex flex-col gap-4">
            <p className="text-lg">
              {deleting.when}. This takes it off the house calendar in Google
              for everyone.
            </p>
            <AttestedForm
              key={deleting.id}
              action={actions.remove}
              label="Delete event"
              pinLabel={pinLabel}
              fields={
                <input type="hidden" name="eventId" value={deleting.id} />
              }
              onResult={(r) => {
                if (toastActionError(r)) return;
                if (r.ok) toast.success(`Deleted ${r.data.title}.`);
                setDeleting(null);
              }}
              onPending={setRemoving}
            />
            <Button
              variant="secondary"
              size="kiosk"
              disabled={removing}
              onClick={() => setDeleting(null)}
            >
              Keep it
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
