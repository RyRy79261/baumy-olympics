import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { householdMembers } from "@/lib/members/household";
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

// The kiosk's bounties (SPEC §8; ADR 0005 §2): once someone taps their
// avatar, the bounty board, acting as them. It moved here from the kiosk home when the home
// became the hub's widgets (issue #20). "Check my PIN" stays, the smallest
// attested request.
//
// Above the grid, the "Needs your OK" banner (SPEC §4.3): the claims waiting
// on the acting member, and their own open ones (undo, add a photo). Every
// button there asks for their PIN.

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
  const [listed, people, pending] = ctx
    ? await Promise.all([
        runAction("list_chores", {}, ctx),
        householdMembers(HOUSEHOLD_ID),
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
          {claims.length > 0 ? (
            <section
              aria-labelledby="needs-ok"
              data-testid="needs-ok-banner"
              className="pixel-frame pixel-frame-4 bg-bm-raised p-5"
            >
              <h2
                id="needs-ok"
                className="mb-4 font-display text-base leading-relaxed text-bm-yellow"
              >
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
    </>
  );
}
