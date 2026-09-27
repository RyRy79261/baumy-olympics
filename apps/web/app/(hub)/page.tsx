import type { Metadata } from "next";
import { Card, PageHeading } from "@baumy/ui";
import { requireMemberPage } from "@/lib/auth";

// The hub home. The widgets (scoreboard, calendar, shopping, notes) arrive
// with their own issues; for now it greets the member.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Baumy Olympics" };

export default async function HubPage() {
  const me = await requireMemberPage();
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Hub"
        description={`Welcome, ${me.displayName}.`}
      />
      <Card title="Coming soon">
        <p className="text-sm text-neutral-700">
          Chores, the scoreboard, the calendar and the shopping list will live
          here.
        </p>
      </Card>
    </>
  );
}
