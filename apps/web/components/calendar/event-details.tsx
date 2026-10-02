import type { CalendarEventView } from "@/lib/calendar/view";
import type { DashboardMember } from "@/lib/kiosk/dashboard";

// An event's facts over its edit form, on the phone and the kitchen screen:
// when, where, who it is for (issue #134) and who added it.

/** A member's name, the house's, or "a former member" for one who left. */
export function forName(
  memberId: string | null,
  people: readonly DashboardMember[],
): string {
  if (!memberId) return "Everyone";
  return (
    people.find((p) => p.id === memberId)?.displayName ?? "a former member"
  );
}

export function EventDetails({
  event,
  people,
  kiosk = false,
}: {
  event: CalendarEventView;
  people: readonly DashboardMember[];
  kiosk?: boolean;
}) {
  return (
    <dl
      className={
        kiosk
          ? "grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-lg"
          : "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"
      }
    >
      <dt className="text-bm-muted">When</dt>
      <dd data-testid="event-when">{event.when}</dd>
      {event.location ? (
        <>
          <dt className="text-bm-muted">Where</dt>
          <dd>{event.location}</dd>
        </>
      ) : null}
      <dt className="text-bm-muted">For</dt>
      <dd data-testid="event-for-name">{forName(event.forMember, people)}</dd>
      {event.addedBy ? (
        <>
          <dt className="text-bm-muted">Added by</dt>
          <dd data-testid="event-added-by">{forName(event.addedBy, people)}</dd>
        </>
      ) : null}
    </dl>
  );
}
