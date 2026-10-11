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

// The kiosk's bounties (SPEC §8; ADR 0005 §2): the bounty board, read as the
// paired screen (`list_chores` passes the `display` gate), so every bounty
// shows even before anyone taps their avatar, only to read (SPEC §12
// decision 38, issue #200). Once someone taps their avatar it acts as them
// and a bounty can be logged. It moved here from the kiosk home when the
// home became the hub's widgets (issue #20). "Check my PIN" stays, the
// smallest attested request. Disputing, undoing and the rest are on the
// Activity page (/kiosk/activity, issue #150).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bounties · Kiosk" };

export default async function KioskChoresPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const acting = kiosk.memberId;
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const [listed, people] = await Promise.all([
    runAction("list_chores", {}, ctx),
    acting ? householdMembers(HOUSEHOLD_ID) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Bounties"
        description={
          acting
            ? `Hi ${kiosk.displayName}. Tap a bounty you just did. Anything that needs your PIN will ask for it.`
            : "Tap your avatar at the top to log one."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      <div className="flex flex-col gap-6">
        {listed.ok ? (
          <ChoreGrid
            chores={listed.data.chores}
            members={people.map((p) => ({
              id: p.id,
              displayName: p.displayName,
            }))}
            actorId={acting ?? null}
            kiosk
            action={kioskLogCompletionAction}
          />
        ) : (
          <FormMessage tone="error">{listed.message}</FormMessage>
        )}
        {acting ? (
          <Card
            title="Check my PIN"
            description="Try your PIN here. It is asked for again on every request that needs it."
            className="max-w-xl"
          >
            <CheckPinForm displayName={kiosk.displayName ?? "Your"} />
          </Card>
        ) : null}
      </div>
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
