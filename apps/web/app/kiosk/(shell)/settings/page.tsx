import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DEFAULT_KIOSK_IDLE_MINUTES } from "@baumy/types";
import { Card, FormMessage, PageHeading, buttonClass } from "@baumy/ui";
import { IdleMinutesForm } from "@/components/kiosk/idle-minutes-form";
import { KioskPointsForm } from "@/components/kiosk/kiosk-points-form";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import {
  kioskSchedulePointsAction,
  kioskSetIdleMinutesAction,
} from "../../actions";

// The kitchen screen's own settings (issue #147), reached from Bounties:
//
// - how many minutes untouched before it forgets who is acting (1, 2, 5, 10
//   or 15; 2 until someone chooses). [UNRESOLVED 2026-10-02] who may change
//   it: for now anyone who has tapped their avatar, with no PIN.
// - for an admin picked here, changing a bounty's points, with their PIN
//   (SPEC §12 decision 28). Adding and editing bounties is Baumy's: ask the
//   cat, and Confirm all asks the admin's PIN.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings · Kiosk" };

export default async function KioskSettingsPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const minutes = kiosk.idleMinutes ?? DEFAULT_KIOSK_IDLE_MINUTES;
  const admin = Boolean(kiosk.memberId) && kiosk.role === "admin";
  const ctx = admin ? await kioskRequestCtx(undefined, undefined) : null;
  const listed = ctx ? await runAction("list_chores", {}, ctx) : null;
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Settings"
        description="This kitchen screen's own settings."
        actions={
          <Link
            href="/kiosk/chores"
            className={buttonClass("secondary", "kiosk")}
          >
            Bounties
          </Link>
        }
      />
      <div className="flex max-w-xl flex-col gap-6">
        <Card
          title="Forget who is acting after"
          description={`Untouched for this long, the screen forgets who tapped their avatar and goes home. Now: ${minutes} min.`}
        >
          {kiosk.memberId ? (
            <IdleMinutesForm
              current={minutes}
              action={kioskSetIdleMinutesAction}
            />
          ) : (
            <p className="text-base text-bm-muted">
              Tap your avatar at the top to change it.
            </p>
          )}
        </Card>
        {admin ? (
          <Card
            title="Change a bounty's points"
            description="As an admin, with your PIN. It applies at the next Monday at least 48 hours ahead, unless someone vetoes it. To add or edit a bounty, ask Baumy."
          >
            {listed?.ok ? (
              <KioskPointsForm
                bounties={listed.data.chores.map((c) => ({
                  id: c.id,
                  name: c.name,
                  basePoints: c.basePoints,
                  cooldownMinutes: c.cooldownMinutes,
                }))}
                pinLabel={`${kiosk.displayName}'s PIN`}
                action={kioskSchedulePointsAction}
              />
            ) : (
              <FormMessage tone="error">
                {listed?.message ?? "The bounties could not be read."}
              </FormMessage>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
