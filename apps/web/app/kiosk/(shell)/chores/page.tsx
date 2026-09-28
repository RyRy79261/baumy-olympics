import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { Card, FormMessage, PageHeading, buttonClass } from "@baumy/ui";
import { ClaimList } from "@/components/claims/claim-list";
import { ChoreGrid } from "@/components/chores/chore-grid";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import { needsOkLabel } from "@/lib/claims/view";
import {
  kioskConcedeClaimAction,
  kioskConfirmClaimAction,
  kioskDisputeClaimAction,
  kioskLogCompletionAction,
  kioskUndoClaimAction,
  kioskWithdrawDisputeAction,
} from "../../actions";
import { CheckPinForm } from "./check-pin-form";

// The kiosk's chores (SPEC §8): once someone taps their avatar, the chore
// grid, acting as them. It moved here from the kiosk home when the home
// became the hub's widgets (issue #20). "Check my PIN" stays, the smallest
// attested request.
//
// Above the grid, the "Needs your OK" banner (SPEC §4.3): the claims waiting
// on the acting member, and their own open ones (undo, add a photo). Every
// button there asks for their PIN.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chores - Kiosk - Baumy" };

export default async function KioskChoresPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const acting = kiosk.memberId;
  const ctx = acting ? await kioskRequestCtx(undefined, undefined) : null;
  const [listed, people, pending] = ctx
    ? await Promise.all([
        runAction("list_chores", {}, ctx),
        listActiveMembers(createHttpDb() as unknown as Queryable, HOUSEHOLD_ID),
        runAction("get_pending_confirmations", {}, ctx),
      ])
    : [null, [], null];
  const claims =
    pending?.ok && acting
      ? pending.data.claims.filter(
          (c) => c.needsYou || c.doneBy === acting || c.loggedBy === acting,
        )
      : [];
  const waiting = pending?.ok ? pending.data.needsYouCount : 0;
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Chores"
        description={
          acting
            ? `Hi ${kiosk.displayName}. Tap a chore you just did. Anything that needs your PIN will ask for it.`
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
          {claims.length > 0 ? (
            <section
              aria-labelledby="needs-ok"
              data-testid="needs-ok-banner"
              className="border-2 border-bm-line bg-bm-raised p-4"
            >
              <h2 id="needs-ok" className="mb-3 text-xl font-semibold">
                {waiting > 0 ? needsOkLabel(waiting) : "Your open claims"}
              </h2>
              <ClaimList
                claims={claims}
                kiosk
                pinLabel={`${kiosk.displayName}'s PIN`}
                actions={{
                  confirm: kioskConfirmClaimAction,
                  dispute: kioskDisputeClaimAction,
                  undo: kioskUndoClaimAction,
                  withdraw: kioskWithdrawDisputeAction,
                  concede: kioskConcedeClaimAction,
                }}
                empty=""
              />
            </section>
          ) : null}
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
