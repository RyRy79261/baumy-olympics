import type { Metadata } from "next";
import { rosterAvatars } from "@baumy/types";
import { rosterColours } from "@/lib/members/characters";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { PageHeading } from "@baumy/ui";
import { HubHome } from "@/components/hub/hub-home";
import { PostReminderForm } from "@/components/hub/post-reminder-form";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { loadHub } from "@/lib/hub/load";
import { voiceConfigured } from "@/lib/integrations/groq";
import { createReminderAction } from "./reminder-actions";
import { addShoppingAction, checkOffShoppingAction } from "./shopping/actions";

// The hub home (SPEC §3.1, issue #20; ADR 0005): the clock and the Urgent,
// New and Messages tiles, the urgent bounties, today's events, the
// standings and the pot, the pinned notes, brain's shopping list and the
// Baumy button, in the kitchen screen's calm look on a scrolling page. The
// kitchen screen has its own home at /kiosk.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Baumy Olympics" };

export default async function HubPage() {
  const me = await requireMemberPage();
  const [hub, people] = await Promise.all([
    uiRequestCtx(undefined).then((ctx) => loadHub(ctx!)),
    listActiveMembers(createHttpDb() as unknown as Queryable, HOUSEHOLD_ID),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Hub"
        description={`Welcome, ${me.displayName}.`}
      />
      <HubHome
        hub={hub}
        voice={voiceConfigured()}
        memberColors={rosterColours(rosterAvatars(people))}
        shopping={{ add: addShoppingAction, checkOff: checkOffShoppingAction }}
      />
      {/* Issue #66: a reminder for the kitchen screen. */}
      <div className="mt-6 max-w-xl">
        <PostReminderForm action={createReminderAction} />
      </div>
    </>
  );
}
