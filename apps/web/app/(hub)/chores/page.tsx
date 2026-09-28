import type { Metadata } from "next";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { FormMessage, PageHeading } from "@baumy/ui";
import { ChoreGrid } from "@/components/chores/chore-grid";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { parseBountyFilter } from "@/lib/chores/view";
import { logCompletionAction } from "./actions";

// /chores, shown as "Bounties" (SPEC §3.2; ADR 0005 §2): the bounty board.
// Tap a bounty, check the preview, log it. The data is `list_chores`, the
// same read the AI and MCP get. `?show=urgent` (or new, consumable,
// maintenance) opens it on that tab: the hub's Urgent and New tiles link
// there.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bounties - Baumy Olympics" };

export default async function ChoresPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const me = await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const [listed, people, params] = await Promise.all([
    runAction("list_chores", {}, ctx),
    listActiveMembers(createHttpDb() as unknown as Queryable, HOUSEHOLD_ID),
    searchParams,
  ]);
  const show = parseBountyFilter(params.show);
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Bounties"
        description="Tap a bounty when it's done. Keep doing one to grow your streak; do someone else's to break theirs for a bonus."
      />
      {listed.ok ? (
        <ChoreGrid
          key={show}
          chores={listed.data.chores}
          members={people.map((p) => ({
            id: p.id,
            displayName: p.displayName,
          }))}
          actorId={me.memberId}
          initialFilter={show}
          action={logCompletionAction}
        />
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
