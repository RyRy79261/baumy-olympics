import type { Metadata } from "next";
import { PageHeading } from "@baumy/ui";
import { HubDashboard } from "@/components/hub/hub-dashboard";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { loadHub } from "@/lib/hub/load";

// The hub home (SPEC §3.1, issue #20): the clock, today's events, the chores
// that are due, the leaderboard and the pot, the pinned notes, the shopping
// list's slot and the Baumy button. The kitchen screen shows the same
// widgets at /kiosk.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Baumy Olympics" };

export default async function HubPage() {
  const me = await requireMemberPage();
  const hub = await loadHub((await uiRequestCtx(undefined))!);
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Hub"
        description={`Welcome, ${me.displayName}.`}
      />
      <HubDashboard
        hub={hub}
        links={{
          calendar: "/calendar",
          chores: "/chores",
          notes: "/notes",
          scores: "/scores",
        }}
      />
    </>
  );
}
