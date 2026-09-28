import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { berlinDateKey } from "@baumy/core";
import { createHttpDb, type Queryable } from "@baumy/db";
import { ActingChip, Housemate, actingDoneClass } from "@baumy/ui";
import { AutoRefresh } from "@/components/hub/auto-refresh";
import { DashboardHeader } from "@/components/kiosk/dashboard/dashboard-header";
import { MonthCalendar } from "@/components/kiosk/dashboard/month-calendar";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { getKioskActor } from "@/lib/auth";
import {
  bountyRows,
  isNewBounty,
  isUrgentBounty,
  monthCells,
  parseMonthParams,
  recentMessages,
} from "@/lib/kiosk/dashboard";
import { loadDashboard } from "@/lib/kiosk/dashboard-load";
import { clearPickAction } from "../actions";

// The kitchen screen's home (ADR 0005, issue #65): the portrait dashboard,
// glanceable across the room with no taps. The header has the date, a big
// clock and the Urgent, New and Messages icons; under it, the month
// calendar, the only home view. It is read as the paired device whether or
// not anyone has tapped in (the `display` gate), never scrolls, and re-reads
// itself every 60 seconds and when it comes back into view.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kiosk - Baumy" };

export default async function KioskHomePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[]; day?: string | string[] }>;
}) {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const today = berlinDateKey(ctx.now);
  const params = await searchParams;
  const { month, day } = parseMonthParams(params, today);
  const data = await loadDashboard(
    ctx,
    month,
    createHttpDb() as unknown as Queryable,
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
            ? { ok: true, rows: recentMessages(data.notes.data, ctx.now) }
            : data.notes
        }
        members={data.members}
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
                <Housemate
                  avatar={
                    data.members.find((m) => m.id === kiosk.memberId)?.avatar
                  }
                  memberId={kiosk.memberId}
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
    </div>
  );
}
