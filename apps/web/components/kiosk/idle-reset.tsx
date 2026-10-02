"use client";

import { usePathname, useRouter } from "next/navigation";
import { KioskNotice } from "@baumy/ui";
import { clearPickAction } from "@/app/kiosk/actions";
import {
  KIOSK_COVER_EVENT,
  KIOSK_IDLE_MS,
  KIOSK_IDLE_WARN_MS,
} from "@/lib/kiosk/constants";
import { useKioskBusy } from "@/lib/kiosk/busy";
import { useIdle } from "./use-idle";

/**
 * After 60 seconds untouched, forget who is acting and go back to the kiosk
 * home (SPEC §8). It watches whenever someone is acting OR the screen is not
 * on the home page, so a calendar left open also goes home. The last ten
 * seconds show a countdown; any touch cancels it. Open dialogs are closed,
 * and the screen goes home even if clearing the pick failed (the cookie's
 * own 10-minute limit is the backstop, and the next minute tries again).
 */
export function IdleReset({ memberPicked }: { memberPicked: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const away = pathname !== "/kiosk";
  // Mid-hold or mid-reply with Baumy (issue #132): wait, and count the
  // minute from when it ends.
  const busy = useKioskBusy();
  const secondsLeft = useIdle(
    (memberPicked || away) && !busy,
    KIOSK_IDLE_MS,
    () => {
      closeOpenDialogs(document);
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

/** Close every open native dialog (a PIN pad, a sheet) before going home. */
export function closeOpenDialogs(doc: Document): void {
  for (const dialog of doc.querySelectorAll("dialog[open]")) {
    (dialog as HTMLDialogElement).close();
  }
  // What is open without being a dialog (Baumy's speech bubble, and any
  // recording in it) closes on this too.
  doc.defaultView?.dispatchEvent(new Event(KIOSK_COVER_EVENT));
}
