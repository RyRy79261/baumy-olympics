import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { AvatarButton, Button, KioskShell } from "@baumy/ui";
import { IdleReset } from "@/components/kiosk/idle-reset";
import { KeepScreenOn } from "@/components/kiosk/keep-screen-on";
import { KioskOverlays } from "@/components/kiosk/overlays";
import { RegisterServiceWorker } from "@/components/kiosk/service-worker";
import { getKioskActor } from "@/lib/auth";
import { runSweepAfterResponse } from "@/lib/background-work";
import { now } from "@/lib/clock";
import {
  NIGHT_TEST_COOKIE,
  isNightAt,
  kioskNightWindow,
} from "@/lib/kiosk/night";
import { clearPickAction, pickMemberAction } from "../actions";

// The kitchen kiosk's shell (SPEC §8): a landscape screen, signed in as a
// paired DEVICE, with the household's avatars along the top. Tapping one
// makes that member the one acting; 60 seconds idle forgets them and goes
// home. It holds the screen wake lock, sleeps at night (issue #29) and
// registers the offline page's service worker. An unpaired or revoked device
// is sent to /kiosk/pair. Nothing here links to the hub or to admin pages,
// and admin actions refuse the kiosk anyway.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kiosk - Baumy" };

export default async function KioskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  // The kitchen screen is the page loaded most: it runs the daily job's
  // sweep too, at most every 15 minutes (lib/background-work.ts).
  runSweepAfterResponse();
  const at = now();
  const night = kioskNightWindow(
    (await cookies()).get(NIGHT_TEST_COOKIE)?.value,
  );
  const people = await listActiveMembers(
    createHttpDb() as unknown as Queryable,
    HOUSEHOLD_ID,
  );

  return (
    <KioskShell
      brand="Baumy"
      skin={isNightAt(at, night) ? "night" : "day"}
      avatars={people.map((p) => (
        <form key={p.id} action={pickMemberAction}>
          <input type="hidden" name="memberId" value={p.id} />
          <AvatarButton
            type="submit"
            displayName={p.displayName}
            sprite={p.avatarSprite}
            color={p.color}
            memberId={p.id}
            avatar={p.avatar}
            selected={p.id === kiosk.memberId}
          />
        </form>
      ))}
      status={
        kiosk.memberId ? (
          <>
            <span data-testid="acting-as">{kiosk.displayName}</span>
            <form action={clearPickAction}>
              <Button type="submit" size="kiosk" variant="secondary">
                Done
              </Button>
            </form>
          </>
        ) : (
          <span className="text-base text-bm-muted">Tap your avatar</span>
        )
      }
    >
      <KeepScreenOn />
      <IdleReset memberPicked={Boolean(kiosk.memberId)} />
      {/* Issue #66: the full-screen reminder and the raccoon screensaver
          (at night, and after 5 minutes untouched), over every page. */}
      <KioskOverlays serverNow={at.toISOString()} window={night} />
      <RegisterServiceWorker />
      {children}
    </KioskShell>
  );
}
