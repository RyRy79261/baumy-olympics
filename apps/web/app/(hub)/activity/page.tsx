import type { Metadata } from "next";
import { FormMessage, PageHeading } from "@baumy/ui";
import { ActivityLog } from "@/components/activity/activity-log";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { vetoWeightAction } from "../admin/weights/actions";
import {
  concedeClaimAction,
  disputeClaimAction,
  resolveDisputeAction,
  undoClaimAction,
  withdrawDisputeAction,
} from "./actions";

// /activity, the activity log (issue #150, SPEC §4.3): what happened in the
// house, newest first, from `get_activity`, the same read the kitchen
// screen, the AI, MCP and brain get. It replaces "Needs your OK": there is
// no confirming (§12 decision 29). A housemate's chore can be disputed while
// its window is open, a scheduled points change vetoed, and your own claims
// undone, conceded or given a photo.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity" };

const DESCRIPTION =
  "What happened in the house: chores logged, disputes, bounties added or edited, and points changes. Dispute a chore within 24 hours of it being logged.";

export default async function ActivityPage() {
  const me = await requireMemberPage();
  const listed = await runAction(
    "get_activity",
    {},
    (await uiRequestCtx(undefined))!,
  );
  return (
    <>
      <PageHeading title="Activity" description={DESCRIPTION} />
      {listed.ok ? (
        <ActivityLog
          entries={listed.data.entries}
          pinLabel={`${me.displayName}'s PIN`}
          actions={{
            dispute: disputeClaimAction,
            undo: undoClaimAction,
            withdraw: withdrawDisputeAction,
            concede: concedeClaimAction,
            veto: vetoWeightAction,
            ...(me.role === "admin" ? { resolve: resolveDisputeAction } : {}),
          }}
        />
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
