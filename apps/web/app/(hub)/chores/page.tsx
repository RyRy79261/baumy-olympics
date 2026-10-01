import type { Metadata } from "next";
import Link from "next/link";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { listActiveSuggestions } from "@baumy/db/weights";
import { FormMessage, PageHeading } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { suggestionView } from "@/lib/actions/weights";
import { requireMemberPage } from "@/lib/auth";
import { NewBountyButton } from "../admin/chores/chore-forms";
import { logCompletionAction } from "./actions";
import { BountyBoard } from "./bounty-board";

// /chores, shown as "Bounties" (SPEC §3.2; ADR 0005 §2): the bounty board.
// Tap a bounty, check the preview, log it. The data is `list_chores`, the
// same read the AI and MCP get. `?show=urgent` (or new, consumable,
// maintenance) opens it on that tab: the hub's Urgent and New tiles link
// there.
//
// An admin also gets New bounty and an Edit button per bounty (issue #109),
// the same dialogs as /admin/chores; points change only through a scheduled
// weight change, which the dialog's points history (issue #115) shows with
// every earlier one. Everyone gets the link to that history for all bounties
// (/chores/history). The actions refuse anyone else whatever the page shows.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bounties" };

export default async function ChoresPage() {
  const me = await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const admin = me.role === "admin";
  const db = createHttpDb() as unknown as Queryable;
  const [listed, people, suggestions, history] = await Promise.all([
    runAction("list_chores", {}, ctx),
    listActiveMembers(db, HOUSEHOLD_ID),
    admin ? listActiveSuggestions(db, HOUSEHOLD_ID) : [],
    admin ? runAction("get_points_history", {}, ctx) : null,
  ]);
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Bounties"
        description="Tap a bounty when it's done. Keep doing one to grow your streak; do someone else's to break theirs for a bonus."
        actions={admin ? <NewBountyButton /> : undefined}
      />
      {listed.ok ? (
        <BountyBoard
          admin={
            admin
              ? {
                  suggestions: suggestions.map(suggestionView),
                  history: history?.ok ? history.data.changes : [],
                }
              : null
          }
          chores={listed.data.chores}
          members={people.map((p) => ({
            id: p.id,
            displayName: p.displayName,
          }))}
          actorId={me.memberId}
          action={logCompletionAction}
        />
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
      <p className="mt-6 text-sm text-bm-muted">
        <Link
          href="/chores/history"
          className="underline underline-offset-4 hover:text-bm-text"
        >
          Points history
        </Link>
        : every change to the bounties&apos; points, and who made or vetoed it.
      </p>
    </>
  );
}
