import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@baumy/ui";
import { getKioskActor } from "@/lib/auth";
import { PairForm } from "./pair-form";

// /kiosk/pair (SPEC §6.2): where an unpaired or revoked kiosk lands. An admin
// creates the code on /admin/members; the iPad types it here once. A kiosk
// that is already paired goes straight to its shell.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pair this kiosk - Baumy" };

export default async function KioskPairPage() {
  if (await getKioskActor()) redirect("/kiosk");
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl touch-manipulation flex-col justify-center gap-6 px-6 py-10">
      <PageHeading
        eyebrow="Baumy kiosk"
        title="Pair this kiosk"
        description="An admin creates a pairing code under Members on their phone. Type it here; it works once, for 10 minutes."
      />
      <PairForm />
    </main>
  );
}
