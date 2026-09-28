import type { Metadata } from "next";
import { rosterAvatars } from "@baumy/types";
import { rosterColours } from "@/lib/members/characters";
import Link from "next/link";
import { redirect } from "next/navigation";
import { berlinDateKey } from "@baumy/core";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { PageHeading, buttonClass } from "@baumy/ui";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { CalendarStatus } from "@/components/calendar/calendar-status";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import { now } from "@/lib/clock";
import { parseViewParams, viewRange } from "@/lib/calendar/view";
import {
  kioskCreateEventAction,
  kioskDeleteEventAction,
  kioskUpdateEventAction,
} from "../../actions";

// The house calendar on the kitchen iPad (SPEC §3.3, §8): the same board as
// /calendar with 56px targets, acting as the member whose avatar was tapped.
// Private events are never shown here (nor anywhere else).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar - Kiosk - Baumy" };

export default async function KioskCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const today = berlinDateKey(now());
  const { view, date } = parseViewParams(await searchParams, today);
  const range = viewRange(view, date);
  const ctx = kiosk.memberId
    ? await kioskRequestCtx(undefined, undefined)
    : null;
  const [listed, people] = ctx
    ? await Promise.all([
        runAction("list_events", { from: range.from, to: range.to }, ctx),
        listActiveMembers(createHttpDb() as unknown as Queryable, HOUSEHOLD_ID),
      ])
    : [null, []];
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Calendar"
        description={
          ctx
            ? "The house calendar. Times are Berlin time."
            : "Tap your avatar at the top to see the calendar."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      {listed === null ? null : listed.ok ? (
        <CalendarBoard
          range={range}
          events={listed.data.events}
          today={today}
          basePath="/kiosk/calendar"
          kiosk
          memberNames={Object.fromEntries(
            people.map((p) => [p.id, p.displayName]),
          )}
          memberColors={rosterColours(rosterAvatars(people))}
          actions={{
            create: kioskCreateEventAction,
            update: kioskUpdateEventAction,
            remove: kioskDeleteEventAction,
          }}
        />
      ) : (
        <CalendarStatus failure={listed} />
      )}
    </>
  );
}
