import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@baumy/ui";
import { getKioskActor } from "@/lib/auth";
import { PairScreen } from "./pair-screen";

// /kiosk/pair (SPEC §6.2, issue #126): where an unpaired or revoked iPad
// lands. It shows a QR code; an admin scans it with their phone and taps
// once, and this screen pairs itself. A kiosk that is already paired goes
// straight to its shell.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Make this the kitchen screen" };

export default async function KioskPairPage() {
  if (await getKioskActor()) redirect("/kiosk");
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl touch-manipulation flex-col justify-center gap-6 px-6 py-10">
      <PageHeading
        eyebrow="Baumy kitchen screen"
        title="Make this the kitchen screen"
        description="An admin scans this code with their phone. Nothing to type here."
      />
      <PairScreen />
    </main>
  );
}
