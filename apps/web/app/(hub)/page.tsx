import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeading } from "@baumy/ui";
import { requireMemberPage } from "@/lib/auth";

// The hub home. The widgets (scoreboard, calendar, shopping, notes) arrive
// with their own issues; for now it greets the member and points at the
// chores.

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
          The scoreboard, the calendar and the shopping list will live here.
          Log what you did under{" "}
          <Link href="/chores" className="underline">
            Chores
          </Link>
          .
        </p>
      </Card>
    </>
  );
}
