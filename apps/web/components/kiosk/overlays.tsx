import { cookies } from "next/headers";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import type { NightWindow } from "@/lib/kiosk/night";
import {
  REMINDERS_TEST_COOKIE,
  kioskShowsReminders,
} from "@/lib/kiosk/reminders";
import { KioskReminders } from "./reminders";
import { KioskScreensaver } from "./screensaver";

// What goes over every kiosk page (ADR 0005 §4, §6; issue #66): the
// full-screen reminder, and the raccoon screensaver over that. The shell
// mounts this once. The reminders are read here, as the kiosk (nobody
// needs to be picked: list_reminders is a `display` read).

export async function KioskOverlays({
  serverNow,
  window,
}: {
  /** The instant the shell was rendered at, ISO 8601. */
  serverNow: string;
  /** The night window; null means no night hours. */
  window: NightWindow | null;
}) {
  const shows = kioskShowsReminders(
    (await cookies()).get(REMINDERS_TEST_COOKIE)?.value,
  );
  const ctx = shows ? await kioskRequestCtx(undefined, undefined) : null;
  const reminders = ctx ? await runAction("list_reminders", {}, ctx) : null;
  return (
    <>
      {shows ? (
        <KioskReminders initial={reminders?.ok ? reminders.data : null} />
      ) : null}
      <KioskScreensaver serverNow={serverNow} window={window} />
    </>
  );
}
