import type { Metadata } from "next";
import { Card, FormMessage, PageHeading } from "@baumy/ui";
import { PointsHistory } from "@/components/chores/points-history";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import type { PointsHistoryView } from "@/lib/actions/weights";
import { requireMemberPage } from "@/lib/auth";

// /chores/history, "Points history" (issue #115, SPEC §4.4): every change to
// every bounty's points, for every member, grouped by bounty: who set or
// scheduled it, from what to what, why, when it applies, and whether it
// landed, is waiting, was vetoed (by whom) or cancelled. The data is
// `get_points_history`. Vetoing a waiting change is on /inbox.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Points history - Baumy Olympics",
};

/** The changes per bounty, bounties by name. */
function byBounty(changes: PointsHistoryView[]) {
  const groups = new Map<string, PointsHistoryView[]>();
  for (const c of changes) {
    groups.set(c.choreId, [...(groups.get(c.choreId) ?? []), c]);
  }
  return [...groups.values()].sort((a, b) =>
    a[0]!.choreName.localeCompare(b[0]!.choreName),
  );
}

export default async function PointsHistoryPage() {
  await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const listed = await runAction("get_points_history", {}, ctx);
  return (
    <>
      <PageHeading
        eyebrow="Bounties"
        title="Points history"
        description="Every change to what the bounties are worth. A scheduled change waits until the Monday it applies, and any member other than the one who scheduled it can veto it on Needs your OK until then."
      />
      {!listed.ok ? (
        <FormMessage tone="error">{listed.message}</FormMessage>
      ) : listed.data.changes.length === 0 ? (
        <p className="text-bm-muted">No bounties have points yet.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {byBounty(listed.data.changes).map((changes) => (
            <div
              key={changes[0]!.choreId}
              data-testid={`history-${changes[0]!.choreName}`}
            >
              <Card title={changes[0]!.choreName}>
                <PointsHistory changes={changes} />
              </Card>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
