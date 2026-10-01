import type { Metadata } from "next";
import { rosterColours } from "@/lib/members/characters";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { PageHeading } from "@baumy/ui";
import { HubHome } from "@/components/hub/hub-home";
import { PostReminderForm } from "@/components/hub/post-reminder-form";
import { uiRequestCtx } from "@/lib/actions/ui";
import { memberOrVisitorPage } from "@/lib/auth";
import {
  LANDING_DESCRIPTION,
  LandingPage,
} from "@/components/landing/landing-page";
import { loadHub } from "@/lib/hub/load";
import { landingMetadata } from "@/lib/seo";
import { voiceConfigured } from "@/lib/integrations/groq";
import { createReminderAction } from "./reminder-actions";
import { addShoppingAction, checkOffShoppingAction } from "./shopping/actions";

// The hub home (SPEC §3.1, issue #20; ADR 0005): the clock and the Urgent,
// New and Messages tiles, the urgent bounties, today's events, the
// standings and the pot, the pinned notes, brain's shopping list and the
// Baumy button, in the kitchen screen's calm look on a scrolling page. The
// kitchen screen has its own home at /kiosk. Nobody signed in gets the
// public landing page instead (issue #96), never a redirect.

export const dynamic = "force-dynamic";
// The one page search engines may index, with its canonical URL (issue
// #122): every other page inherits the root layout's noindex.
export const metadata: Metadata = landingMetadata(LANDING_DESCRIPTION);

export default async function HubPage() {
  const me = await memberOrVisitorPage();
  if (!me) return <LandingPage />;
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
        memberColors={rosterColours(people)}
        shopping={{ add: addShoppingAction, checkOff: checkOffShoppingAction }}
      />
      {/* Issue #66: a reminder for the kitchen screen. */}
      <div className="mt-6 max-w-xl">
        <PostReminderForm action={createReminderAction} />
      </div>
    </>
  );
}
