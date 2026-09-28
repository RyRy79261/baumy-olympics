import type { Metadata } from "next";
import { PageHeading } from "@baumy/ui";
import { HubDashboard } from "@/components/hub/hub-dashboard";
import { PostReminderForm } from "@/components/hub/post-reminder-form";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { loadHub } from "@/lib/hub/load";
import { voiceConfigured } from "@/lib/integrations/groq";
import { createReminderAction } from "./reminder-actions";
import { addShoppingAction, checkOffShoppingAction } from "./shopping/actions";

// The hub home (SPEC §3.1, issue #20): the clock, today's events, the chores
// that are due, the leaderboard and the pot, the pinned notes, brain's
// shopping list and the Baumy button. The kitchen screen shows the same
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
        voice={voiceConfigured()}
        links={{
          calendar: "/calendar",
          chores: "/chores",
          notes: "/notes",
          shopping: "/shopping",
          scores: "/scores",
        }}
        shopping={{
          canEdit: true,
          actions: { add: addShoppingAction, checkOff: checkOffShoppingAction },
        }}
      />
      {/* Issue #66: a reminder for the kitchen screen. */}
      <div className="mt-6 max-w-xl">
        <PostReminderForm action={createReminderAction} />
      </div>
    </>
  );
}
