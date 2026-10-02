import type { Metadata } from "next";
import { berlinDateKey } from "@baumy/core";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { PageHeading } from "@baumy/ui";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { CalendarStatus } from "@/components/calendar/calendar-status";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { rosterColours } from "@/lib/members/characters";
import { householdPeople } from "@/lib/members/household";
import { parseViewParams, viewRange } from "@/lib/calendar/view";
import {
  createEventAction,
  deleteEventAction,
  updateEventAction,
} from "./actions";

// /calendar (SPEC §3.3): the house's shared Google Calendar in Day, Week and
// Month views, with sheets to add and edit events and a confirmed delete.
// Private events are never shown. Without Google credentials the page says
// the calendar is not connected, rather than failing.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const today = berlinDateKey(ctx.now);
  const { view, date } = parseViewParams(await searchParams, today);
  const range = viewRange(view, date);
  const [listed, people] = await Promise.all([
    runAction("list_events", { from: range.from, to: range.to }, ctx),
    householdPeople(HOUSEHOLD_ID),
  ]);
  return (
    <>
      <PageHeading
        title="Calendar"
        description="The house's shared Google Calendar. Times are Berlin time."
      />
      {listed.ok ? (
        <CalendarBoard
          range={range}
          events={listed.data.events}
          today={today}
          people={people}
          memberColors={rosterColours(people)}
          actions={{
            create: createEventAction,
            update: updateEventAction,
            remove: deleteEventAction,
          }}
        />
      ) : (
        <CalendarStatus failure={listed} />
      )}
    </>
  );
}
