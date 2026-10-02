import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { berlinDateKey } from "@baumy/core";
import { ActingChip, actingDoneClass } from "@baumy/ui";
import { cookies } from "next/headers";
import { ForgetWalkIn } from "@/components/kiosk/forget-cookie";
import { ScoreEmote } from "@/components/members/score-emote";
import { KIOSK_WALK_IN_COOKIE, walksIn } from "@/lib/kiosk/cookies";
import { AutoRefresh } from "@/components/hub/auto-refresh";
import { DashboardHeader } from "@/components/kiosk/dashboard/dashboard-header";
import { MonthCalendar } from "@/components/kiosk/dashboard/month-calendar";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { getKioskActor } from "@/lib/auth";
import { householdMembers } from "@/lib/members/household";
import {
  bountyRows,
  isNewBounty,
  isUrgentBounty,
  monthCells,
  parseMonthParams,
  unseenMessages,
} from "@/lib/kiosk/dashboard";
import { loadDashboard } from "@/lib/kiosk/dashboard-load";
import { clearPickAction } from "../actions";
import { kioskSeeNotesAction } from "../note-actions";

// The kitchen screen's home (ADR 0005, issue #65): the portrait dashboard,
// glanceable across the room with no taps. The header has the date, a big
// clock and the Urgent, New and Messages icons; under it, the month
// calendar, the only home view. It is read as the paired device whether or
// not anyone has tapped in (the `display` gate), never scrolls, and re-reads
// itself every 60 seconds and when it comes back into view.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kiosk" };

export default async function KioskHomePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[]; day?: string | string[] }>;
}) {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  // Walk in only for the tap that just picked them (issue #111).
  const walkIn = walksIn(
    (await cookies()).get(KIOSK_WALK_IN_COOKIE)?.value,
    kiosk.memberId,
  );
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const today = berlinDateKey(ctx.now);
  const params = await searchParams;
  const { month, day } = parseMonthParams(params, today);
  const data = await loadDashboard(ctx, month, () =>
    householdMembers(ctx.householdId),
  );
  const bounties = (pick: typeof isUrgentBounty) =>
    data.chores.ok
      ? {
          ok: true as const,
          rows: bountyRows(data.chores.data, pick, data.members, ctx.now),
        }
      : data.chores;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="kiosk-home">
      {/* The dashboard is its own heading; this names the page for readers. */}
      <h1 className="sr-only">Kitchen</h1>
      <DashboardHeader
        serverNow={data.now}
        urgent={bounties(isUrgentBounty)}
        fresh={bounties(isNewBounty)}
        messages={
          data.notes.ok
            ? {
                ok: true,
                rows: unseenMessages(
                  data.notes.data.notes,
                  data.members,
                  ctx.now,
                ),
                count: data.notes.data.unseenByAnyoneCount,
              }
            : data.notes
        }
        members={data.members}
        actingId={kiosk.memberId ?? null}
        seeNotes={kioskSeeNotesAction}
      />
      <MonthCalendar
        key={month}
        month={month}
        today={data.today}
        cells={monthCells(month, today, data.events.ok ? data.events.data : [])}
        members={data.members}
        initialDay={day}
        dayInUrl={params.day !== undefined}
        status={data.events.ok ? null : data.events.message}
        acting={
          kiosk.memberId ? (
            // Whose name a tap logs under, so the next person sees it.
            <ActingChip
              name={kiosk.displayName ?? ""}
              who={
                <ScoreEmote
                  moment={walkIn ? "walk-in" : undefined}
                  sprites={
                    data.members.find((m) => m.id === kiosk.memberId)?.sprites
                  }
                  name={kiosk.displayName ?? ""}
                  colour={
                    data.members.find((m) => m.id === kiosk.memberId)?.color
                  }
                  scale={2}
                />
              }
              done={
                <form action={clearPickAction}>
                  <button type="submit" className={actingDoneClass}>
                    Done
                  </button>
                </form>
              }
            />
          ) : undefined
        }
      />
      <AutoRefresh />
      {walkIn ? <ForgetWalkIn /> : null}
    </div>
  );
}
