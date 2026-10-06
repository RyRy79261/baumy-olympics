import type { Metadata } from "next";
import { Card, FormMessage, PageHeading } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireAdminPage } from "@/lib/auth";
import { CreateChoreForm } from "./chore-forms";
import { ChoresCard } from "./chores-card";

// /admin/chores (SPEC §4.4): admins add chores, change their points,
// cooldown, proof and effort, and archive or restore them, one at a time or
// many at once (issue #175). Anyone else
// gets a 404 from the page gate, and `manage_chore` refuses them anyway.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit chores" };

export default async function AdminChoresPage() {
  await requireAdminPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const listed = await runAction("list_chores", { includeArchived: true }, ctx);
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Edit chores"
        description="The chores the household plays for. Changing points or a cooldown never changes what was already scored."
      />
      <div className="flex flex-col gap-6">
        <CreateChoreForm />
        {listed.ok ? (
          <ChoresCard chores={listed.data.chores} />
        ) : (
          <Card title="Chores">
            <FormMessage tone="error">{listed.message}</FormMessage>
          </Card>
        )}
      </div>
    </>
  );
}
