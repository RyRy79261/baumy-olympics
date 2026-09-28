import type { Metadata } from "next";
import { rosterAvatars } from "@baumy/types";
import { rosterColours } from "@/lib/members/characters";
import { berlinDateKey } from "@baumy/core";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { PageHeading } from "@baumy/ui";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { CalendarStatus } from "@/components/calendar/calendar-status";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
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
export const metadata: Metadata = { title: "Calendar - Baumy Olympics" };

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
    listActiveMembers(createHttpDb() as unknown as Queryable, HOUSEHOLD_ID),
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
          basePath="/calendar"
          memberNames={Object.fromEntries(
            people.map((p) => [p.id, p.displayName]),
          )}
          memberColors={rosterColours(rosterAvatars(people))}
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
