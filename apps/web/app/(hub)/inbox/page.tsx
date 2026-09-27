import type { Metadata } from "next";
import { Card, FormMessage, PageHeading } from "@baumy/ui";
import { ClaimList } from "@/components/claims/claim-list";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { needsOkLabel, settledLabel } from "@/lib/claims/view";
import { ScheduledChanges } from "../admin/weights/scheduled-changes";
import {
  concedeClaimAction,
  confirmClaimAction,
  disputeClaimAction,
  resolveDisputeAction,
  undoClaimAction,
  withdrawDisputeAction,
} from "./actions";

// /inbox, "Needs your OK" (SPEC §4.3): the claims waiting on you (confirm or
// dispute a housemate's, answer a dispute on yours, withdraw your own
// dispute, rule as an admin), then your own open claims (undo within 10
// minutes, add a photo), then how your recent claims settled. The data is
// `get_pending_confirmations`, the same read the AI and MCP get.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Needs your OK - Baumy Olympics" };

export default async function InboxPage() {
  const me = await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const listed = await runAction("get_pending_confirmations", {}, ctx);
  // Weight changes waiting to apply, which any other member may veto.
  const weights = await runAction("get_weights", { scheduledOnly: true }, ctx);
  const scheduled = weights.ok ? weights.data.scheduled : [];
  const actions = {
    confirm: confirmClaimAction,
    dispute: disputeClaimAction,
    undo: undoClaimAction,
    withdraw: withdrawDisputeAction,
    concede: concedeClaimAction,
    ...(me.role === "admin" ? { resolve: resolveDisputeAction } : {}),
  };
  if (!listed.ok) {
    return (
      <>
        <PageHeading eyebrow="Baumy Olympics" title="Needs your OK" />
        <FormMessage tone="error">{listed.message}</FormMessage>
      </>
    );
  }
  const { claims, needsYouCount, recent } = listed.data;
  const needsYou = claims.filter((c) => c.needsYou);
  const mine = claims.filter(
    (c) =>
      !c.needsYou && (c.doneBy === me.memberId || c.loggedBy === me.memberId),
  );
  const others = claims.filter((c) => !c.needsYou && !mine.includes(c));
  const pinLabel = `${me.displayName}'s PIN`;
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Needs your OK"
        description={
          needsYouCount > 0
            ? `${needsOkLabel(needsYouCount)}.`
            : "Nothing is waiting on you."
        }
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="needs-you" data-testid="needs-you">
          <h2 id="needs-you" className="mb-3 text-lg font-semibold">
            Waiting on you
          </h2>
          <ClaimList
            claims={needsYou}
            actions={actions}
            pinLabel={pinLabel}
            empty="Nothing needs your OK right now."
          />
        </section>
        <section aria-labelledby="yours" data-testid="your-claims">
          <h2 id="yours" className="mb-3 text-lg font-semibold">
            Your open claims
          </h2>
          <ClaimList
            claims={mine}
            actions={actions}
            pinLabel={pinLabel}
            empty="You have no claims waiting to settle."
          />
        </section>
        {scheduled.length > 0 ? (
          <Card
            title="Point changes coming"
            description="Each applies unless someone other than the member who scheduled it vetoes it first."
            data-testid="weight-changes"
          >
            <ScheduledChanges changes={scheduled} />
          </Card>
        ) : null}
        {others.length > 0 ? (
          <section aria-labelledby="others" data-testid="other-claims">
            <h2 id="others" className="mb-3 text-lg font-semibold">
              Everyone else's
            </h2>
            <ClaimList
              claims={others}
              actions={actions}
              pinLabel={pinLabel}
              empty=""
            />
          </section>
        ) : null}
        <Card title="Recently settled" data-testid="recently-settled">
          {recent.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {recent.map((s) => (
                <li key={s.completionId} data-testid={`settled-${s.choreName}`}>
                  {settledLabel(s)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-600">
              None of your claims settled in the last 7 days.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
