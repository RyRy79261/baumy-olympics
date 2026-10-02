import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { berlinDateKey } from "@baumy/core";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { PageHeading, buttonClass } from "@baumy/ui";
import { KioskCalendarStatus } from "@/components/calendar/calendar-status";
import { CalendarManager } from "@/components/kiosk/calendar-manager";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import { upcomingGroups, upcomingRange } from "@/lib/calendar/upcoming";
import { householdPeople } from "@/lib/members/household";
import {
  kioskCreateEventAction,
  kioskDeleteEventAction,
  kioskUpdateEventAction,
} from "../../actions";

// The Calendar tab on the kitchen iPad (issue #134, SPEC §3.3, §8): the
// dashboard at /kiosk already shows the month, so this is the manager.
// Anyone can read what is coming up; the member whose avatar was tapped can
// add, change or delete an event, and each change asks for their PIN in
// that request (SPEC §6.2). Private events are never shown here (nor
// anywhere else). Without Google, it says so and offers nothing to change.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar · Kiosk" };

export default async function KioskCalendarPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const today = berlinDateKey(ctx.now);
  const [listed, people] = await Promise.all([
    runAction("list_events", upcomingRange(today), ctx),
    householdPeople(HOUSEHOLD_ID),
  ]);
  const acting = Boolean(kiosk.memberId);
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Calendar"
        description={
          !listed.ok
            ? "The house calendar."
            : acting
              ? "What's coming up. Tap an event to change it; changes ask for your PIN."
              : "What's coming up. Tap your avatar at the top to add or change an event."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      {listed.ok ? (
        <CalendarManager
          groups={upcomingGroups(listed.data.events, ctx.now)}
          today={today}
          people={people}
          canEdit={acting}
          pinLabel={`${kiosk.displayName ?? "Your"}'s PIN`}
          actions={{
            create: kioskCreateEventAction,
            update: kioskUpdateEventAction,
            remove: kioskDeleteEventAction,
          }}
        />
      ) : (
        <KioskCalendarStatus failure={listed} />
      )}
    </>
  );
}
