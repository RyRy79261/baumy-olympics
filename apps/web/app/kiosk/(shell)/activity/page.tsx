import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormMessage, PageHeading, buttonClass } from "@baumy/ui";
import { ActivityLog } from "@/components/activity/activity-log";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import {
  kioskConcedeClaimAction,
  kioskDisputeClaimAction,
  kioskUndoClaimAction,
  kioskWithdrawDisputeAction,
} from "../../actions";

// The activity log on the kitchen iPad (issue #150, SPEC §4.3, §8): what
// happened in the house, newest first, read as the paired device
// (`get_activity` needs only `display`). Once someone taps their avatar,
// their entries get the buttons that apply to them: Dispute a housemate's
// chore while its window is open (with their PIN, §12 decision 27), and
// Undo, Withdraw, Concede or a photo with none. Vetoing a points change and
// an admin's ruling stay on the phone.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity · Kiosk" };

export default async function KioskActivityPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const listed = await runAction("get_activity", {}, ctx);
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Activity"
        description={
          kiosk.memberId
            ? "What happened in the house. Disputing a chore asks for your PIN."
            : "What happened in the house. Tap your avatar at the top to dispute a chore."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      {listed.ok ? (
        <ActivityLog
          entries={listed.data.entries}
          kiosk
          pinLabel={`${kiosk.displayName ?? "Your"}'s PIN`}
          actions={{
            dispute: kioskDisputeClaimAction,
            undo: kioskUndoClaimAction,
            withdraw: kioskWithdrawDisputeAction,
            concede: kioskConcedeClaimAction,
          }}
        />
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
