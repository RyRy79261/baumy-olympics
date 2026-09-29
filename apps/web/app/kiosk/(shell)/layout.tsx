import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { rosterAvatars } from "@baumy/types";
import { AvatarButton, Button, KioskShell, KioskTopBar } from "@baumy/ui";
import { BaumySheet } from "@/components/baumy/baumy-sheet";
import { IdleReset } from "@/components/kiosk/idle-reset";
import { KeepScreenOn } from "@/components/kiosk/keep-screen-on";
import { KioskFrame, KioskNav } from "@/components/kiosk/kiosk-frame";
import { KioskOverlays } from "@/components/kiosk/overlays";
import { RegisterServiceWorker } from "@/components/kiosk/service-worker";
import { getKioskActor } from "@/lib/auth";
import { avatarImageView } from "@/lib/avatars/paths";
import { runSweepAfterResponse } from "@/lib/background-work";
import { now } from "@/lib/clock";
import { voiceConfigured } from "@/lib/integrations/groq";
import {
  NIGHT_TEST_COOKIE,
  isNightAt,
  kioskNightWindow,
} from "@/lib/kiosk/night";
import { clearPickAction, pickMemberAction } from "../actions";

// The kitchen kiosk's shell (SPEC §8, ADR 0005): a portrait screen
// (820×1180), signed in as a paired DEVICE. The home is the dashboard; every
// page has the footer nav (Home, Bounties, Calendar, Board, Shop, Scores)
// with Baumy standing over its right end, and the other pages have the
// avatar bar on top. Tapping an avatar (there, or in Baumy's bubble or sheet) makes
// that member the one acting; 60 seconds idle forgets them and goes home.
// It holds the screen wake lock (issue #29) and registers
// the offline page's service worker. An unpaired or revoked device is sent
// to /kiosk/pair. Nothing here links to the hub or to admin pages, and
// admin actions refuse the kiosk anyway. Full-screen overlays (issue #66's
// reminder and screensaver) mount in KioskOverlays, last, over everything.

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

  // Members who have not chosen a character wear shirts nobody else wears.
  const roster = rosterAvatars(people);
  const avatars = people.map((p) => (
    <form key={p.id} action={pickMemberAction}>
      <input type="hidden" name="memberId" value={p.id} />
      <AvatarButton
        type="submit"
        displayName={p.displayName}
        sprite={p.avatarSprite}
        color={p.color}
        avatar={roster.get(p.id)}
        image={avatarImageView(p.avatarImage)}
        memberId={p.id}
        selected={p.id === kiosk.memberId}
      />
    </form>
  ));

  return (
    <KioskShell
      skin={isNightAt(at, night) ? "night" : "day"}
      footer={<KioskNav />}
      corner={
        <BaumySheet
          kiosk
          cat
          actingName={kiosk.displayName}
          voice={voiceConfigured()}
          who={avatars}
        />
      }
    >
      <KioskFrame
        top={
          <KioskTopBar
            avatars={avatars}
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
          />
        }
      >
        {children}
      </KioskFrame>
      <KeepScreenOn />
      <IdleReset memberPicked={Boolean(kiosk.memberId)} />
      {/* Issue #66: the full-screen reminder and the raccoon screensaver
          (at night, and after 5 minutes untouched), over every page. */}
      <KioskOverlays serverNow={at.toISOString()} window={night} />
      <RegisterServiceWorker />
    </KioskShell>
  );
}
