import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { Card, FormMessage, PageHeading } from "@baumy/ui";
import { ChoreGrid } from "@/components/chores/chore-grid";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import { kioskLogCompletionAction } from "../actions";
import { CheckPinForm } from "./check-pin-form";

// The kiosk home (SPEC §8): once someone taps their avatar, the chore grid,
// acting as them. The other widgets (scoreboard, calendar, shopping, notes)
// arrive with their own issues. "Check my PIN" stays, the smallest attested
// request.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kiosk - Baumy" };

export default async function KioskHomePage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const acting = kiosk.memberId;
  const [listed, people] = acting
    ? await Promise.all([
        kioskRequestCtx(undefined, undefined).then((ctx) =>
          runAction("list_chores", {}, ctx!),
        ),
        listActiveMembers(createHttpDb() as unknown as Queryable, HOUSEHOLD_ID),
      ])
    : [null, []];
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Kitchen"
        description={
          acting
            ? `Hi ${kiosk.displayName}. Tap a chore you just did. Anything that needs your PIN will ask for it.`
            : "Tap your avatar at the top to start."
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
    </>
  );
}
