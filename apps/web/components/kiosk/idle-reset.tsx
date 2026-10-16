"use client";

import { usePathname, useRouter } from "next/navigation";
import { KioskNotice } from "@baumy/ui";
import { clearPickAction } from "@/app/kiosk/actions";
import { KIOSK_IDLE_MS, KIOSK_IDLE_WARN_MS } from "@/lib/kiosk/constants";
import { takeScreen, useScreenHeld } from "@/lib/kiosk/screen";
import { useIdle } from "./use-idle";

/**
 * After the screen's idle minutes untouched (`idleMs`: 2 minutes unless
 * chosen on the kiosk, issue #147), forget who is acting and go back to the
 * kiosk home (SPEC §8). With nobody acting, a page left open away from the
 * home goes home after a minute. It watches whenever someone is acting OR
 * the screen is not on the home page, so a calendar left open also goes
 * home. The last ten
 * seconds show a countdown; any touch cancels it. It takes the screen
 * (lib/kiosk/screen.ts: open dialogs close), and goes home even if clearing
 * the pick failed (the cookie's own 10-minute limit is the backstop, and the
 * next minute tries again).
 */
export function IdleReset({
  memberPicked,
  idleMs = KIOSK_IDLE_MS,
}: {
  memberPicked: boolean;
  /** How long untouched before the one acting is forgotten. */
  idleMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const away = pathname !== "/kiosk";
  // Mid-hold or mid-reply with Baumy (issue #132): wait, and count the
  // minute from when it ends.
  const held = useScreenHeld("idle-reset");
  const secondsLeft = useIdle(
    (memberPicked || away) && !held,
    memberPicked ? idleMs : KIOSK_IDLE_MS,
    () => {
      // Held by something the screen's rules say waits: try again a wait
      // later.
      if (!takeScreen("idle-reset", document)) return;
      const cleared = memberPicked ? clearPickAction() : Promise.resolve();
      void cleared
        .catch(() => {})
        .finally(() => {
          router.replace("/kiosk");
          router.refresh();
        });
    },
    KIOSK_IDLE_WARN_MS,
  );
  if (secondsLeft === null) return null;
  return (
    <KioskNotice data-testid="idle-countdown">
      {memberPicked ? "Signing out and going" : "Going"} back to the start in{" "}
      {secondsLeft} s. Touch the screen to stay.
    </KioskNotice>
  );
}
