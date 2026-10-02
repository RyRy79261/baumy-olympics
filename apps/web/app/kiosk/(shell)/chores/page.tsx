import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { householdMembers } from "@/lib/members/household";
import { Card, FormMessage, PageHeading, buttonClass } from "@baumy/ui";
import { ChoreGrid } from "@/components/chores/chore-grid";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import { kioskLogCompletionAction } from "../../actions";
import { CheckPinForm } from "./check-pin-form";

// The kiosk's bounties (SPEC §8; ADR 0005 §2): once someone taps their
// avatar, the bounty board, acting as them. It moved here from the kiosk home when the home
// became the hub's widgets (issue #20). "Check my PIN" stays, the smallest
// attested request. Disputing, undoing and the rest are on the Activity
// page (/kiosk/activity, issue #150).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bounties · Kiosk" };

export default async function KioskChoresPage({
  searchParams,
}: {
  /** `chore`: the dashboard's "I'll do it" opens that chore's sheet. */
  searchParams: Promise<{ chore?: string | string[] }>;
}) {
  const { chore } = await searchParams;
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const acting = kiosk.memberId;
  const ctx = acting ? await kioskRequestCtx(undefined, undefined) : null;
  const [listed, people] = ctx
    ? await Promise.all([
        runAction("list_chores", {}, ctx),
        householdMembers(HOUSEHOLD_ID),
      ])
    : [null, []];
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Bounties"
        description={
          acting
            ? `Hi ${kiosk.displayName}. Tap a bounty you just did. Anything that needs your PIN will ask for it.`
            : "Tap your avatar at the top to start."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      {acting && listed ? (
        <div className="flex flex-col gap-6">
          {listed.ok ? (
            <ChoreGrid
              chores={listed.data.chores}
              members={people.map((p) => ({
                id: p.id,
                displayName: p.displayName,
              }))}
              actorId={acting}
              kiosk
              action={kioskLogCompletionAction}
              initialOpenId={Array.isArray(chore) ? chore[0] : chore}
            />
          ) : (
            <FormMessage tone="error">{listed.message}</FormMessage>
          )}
          <Card
            title="Check my PIN"
            description="Try your PIN here. It is asked for again on every request that needs it."
            className="max-w-xl"
          >
            <CheckPinForm displayName={kiosk.displayName ?? "Your"} />
          </Card>
        </div>
      ) : null}
      {/* Issue #147: the screen's own settings, with or without a pick. */}
      <Card
        title="This screen"
        description="How long it waits before it forgets who is acting, and, for an admin, a bounty's points."
        className="mt-6 max-w-xl"
      >
        <Link
          href="/kiosk/settings"
          className={buttonClass("secondary", "kiosk", "self-start")}
        >
          Kitchen screen settings
        </Link>
      </Card>
    </>
  );
}
