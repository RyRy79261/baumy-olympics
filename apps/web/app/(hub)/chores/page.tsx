import type { Metadata } from "next";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { FormMessage, PageHeading } from "@baumy/ui";
import { ChoreGrid } from "@/components/chores/chore-grid";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { logCompletionAction } from "./actions";

// /chores (SPEC §3.2): the chore grid. Tap a chore, check the preview, log
// it. The data is `list_chores`, the same read the AI and MCP get.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chores - Baumy Olympics" };

export default async function ChoresPage() {
  const me = await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const [listed, people] = await Promise.all([
    runAction("list_chores", {}, ctx),
    listActiveMembers(createHttpDb() as unknown as Queryable, HOUSEHOLD_ID),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Chores"
        description="Tap a chore when it's done. Keep doing one to grow your streak; do someone else's to break theirs for a bonus."
      />
      {listed.ok ? (
        <ChoreGrid
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
    </>
  );
}
