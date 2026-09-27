import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@baumy/ui";
import { AutoRefresh } from "@/components/hub/auto-refresh";
import { HubDashboard } from "@/components/hub/hub-dashboard";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { getKioskActor } from "@/lib/auth";
import { loadHub } from "@/lib/hub/load";

// The kitchen screen's home (SPEC §3.1, §8, issue #20): the hub's widgets on
// one landscape screen that never scrolls at 1180×820, read as the paired
// device whether or not anyone has tapped their avatar (the `display` gate).
// It re-reads itself every 60 seconds and when it comes back into view. The
// widgets' links lead to the kiosk's chores, calendar and notes, where the
// acting member does things.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kiosk - Baumy" };

export default async function KioskHomePage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const hub = await loadHub(ctx);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="kiosk-home">
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Kitchen"
        description={
          kiosk.memberId
            ? `Hi ${kiosk.displayName}. Open Chores to log what you did.`
            : "Tap your avatar at the top to log a chore or change a note."
        }
      />
      <HubDashboard
        hub={hub}
        kiosk
        links={{
          calendar: "/kiosk/calendar",
          chores: "/kiosk/chores",
          notes: "/kiosk/notes",
        }}
      />
      <AutoRefresh />
    </div>
  );
}
