import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { AvatarButton, Button, KioskShell, KioskTopBar } from "@baumy/ui";
import { BaumySheet } from "@/components/baumy/baumy-sheet";
import { ActingPinProvider } from "@/components/kiosk/acting-pin";
import { FeedbackGate } from "@/components/feedback/feedback-gate";
import { IdleReset } from "@/components/kiosk/idle-reset";
import { KeepScreenOn } from "@/components/kiosk/keep-screen-on";
import { KioskFrame, KioskNav } from "@/components/kiosk/kiosk-frame";
import { KioskOverlays } from "@/components/kiosk/overlays";
import { RegisterServiceWorker } from "@/components/kiosk/service-worker";
import { ScoreEmote } from "@/components/members/score-emote";
import { getKioskActor } from "@/lib/auth";
import { householdMembers } from "@/lib/members/household";
import { avatarImageView } from "@/lib/avatars/paths";
import { runSweepAfterResponse } from "@/lib/background-work";
import { now } from "@/lib/clock";
import { reportAiAvailable } from "@/lib/feedback/ai";
import { voiceConfigured } from "@/lib/integrations/groq";
import { actingMemberHasPin } from "@/lib/kiosk/acting-pin";
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
export const metadata: Metadata = { title: "Kiosk" };

export default async function KioskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  // The avatar bar's members: one read, shared with the page below
  // (lib/members/household.ts, issue #128), and only for a paired device.
  const members = householdMembers(HOUSEHOLD_ID);
  // The kitchen screen is the page loaded most: it runs the daily job's
  // sweep too, at most every 15 minutes (lib/background-work.ts).
  runSweepAfterResponse();
  const at = now();
  const night = kioskNightWindow(
    (await cookies()).get(NIGHT_TEST_COOKIE)?.value,
  );
  // Whether the acting member has a personal PIN (issue #145): a form that
  // needs one shows "<Name> hasn't set a personal PIN yet" instead of a
  // PinPad they cannot use. One boolean, for the member picked here.
  const [people, hasPin] = await Promise.all([
    members,
    actingMemberHasPin(HOUSEHOLD_ID, kiosk.memberId),
  ]);

  const avatars = people.map((p) => (
    <form key={p.id} action={pickMemberAction}>
      <input type="hidden" name="memberId" value={p.id} />
      <AvatarButton
        type="submit"
        displayName={p.displayName}
        color={p.color}
        sprites={avatarImageView(p.avatarImage)}
        character={
          p.id === kiosk.memberId ? (
            // Whoever is acting emotes when they score (issue #111).
            <ScoreEmote
              sprites={avatarImageView(p.avatarImage)}
              name={p.displayName}
              colour={p.color}
              scale={2}
            />
          ) : undefined
        }
        selected={p.id === kiosk.memberId}
      />
    </form>
  ));

  return (
    <ActingPinProvider value={{ name: kiosk.displayName, hasPin }}>
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
                  <span className="text-base text-bm-muted">
                    Tap your avatar
                  </span>
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
        {/* Shake the iPad to report a bug (issue #133), as whoever is
          acting; the first tap asks iOS for motion events. */}
        <FeedbackGate
          surface="kiosk"
          aiAvailable={reportAiAvailable()}
          blocked={
            kiosk.memberId
              ? null
              : "Tap your avatar first: a report is filed as the member acting."
          }
        />
        <RegisterServiceWorker />
      </KioskShell>
    </ActingPinProvider>
  );
}
