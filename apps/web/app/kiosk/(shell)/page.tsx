import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, PageHeading } from "@baumy/ui";
import { getKioskActor } from "@/lib/auth";
import { CheckPinForm } from "./check-pin-form";

// The kiosk home. The widgets (chores, scoreboard, calendar, shopping,
// notes) arrive with their own issues; for now it shows who is acting and
// lets them check their PIN, the smallest attested request.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kiosk - Baumy" };

export default async function KioskHomePage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Kitchen"
        description={
          kiosk.memberId
            ? `Hi ${kiosk.displayName}. Anything that needs your PIN will ask for it.`
            : "Tap your avatar at the top to start."
        }
      />
      {kiosk.memberId ? (
        <Card
          title="Check my PIN"
          description="Try your PIN here. It is asked for again on every request that needs it."
          className="max-w-xl"
        >
          <CheckPinForm displayName={kiosk.displayName ?? "Your"} />
        </Card>
      ) : null}
    </>
  );
}
