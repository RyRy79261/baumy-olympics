"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Screensaver } from "@baumy/ui";
import { clockLines } from "@/lib/hub/view";
import { KIOSK_IDLE_MS, SCREENSAVER_IDLE_MS } from "@/lib/kiosk/constants";
import {
  NIGHT_EVENT,
  isNightAt,
  type NightEventDetail,
  type NightWindow,
} from "@/lib/kiosk/night";
import { closeOpenDialogs } from "./idle-reset";

// The kitchen screen's raccoon screensaver (ADR 0005 §6; SPEC §8, issues #29
// and #66). It shows:
//
// - at night: inside the window (23:00-06:30 Berlin by default,
//   `KIOSK_NIGHT_HOURS`, lib/kiosk/night.ts) at once, and again after a
//   minute untouched once someone has woken it; the morning wakes it;
// - by day: after 5 minutes untouched, unless a reminder is up (the
//   reminder is what the room should see).
//
// A tap wakes it (the Screensaver is one big button, so the tap never lands
// on the page). It keeps the server's time the way the hub clock does (the
// server's `now` at render, plus how far this device's clock has moved
// since), so e2e's moved server clock moves it too.
//
// Its memory (asleep, the last touch, whether it was night at the last
// tick) lives in refs, so the kiosk home's 60-second refresh, which hands it
// a new `serverNow`, never puts a screen someone is using back to sleep.

/** A full-screen reminder is showing (components/kiosk/reminders.tsx). */
function reminderShowing(): boolean {
  return document.querySelector("[data-reminder]") !== null;
}

export function KioskScreensaver({
  serverNow,
  window: nightWindow,
}: {
  /** The instant the shell was rendered at, ISO 8601. */
  serverNow: string;
  /** null: no night hours (the idle screensaver still runs). */
  window: NightWindow | null;
}) {
  const [asleep, setAsleep] = useState(false);
  const [now, setNow] = useState(() => new Date(serverNow));
  const asleepRef = useRef(false);
  const wasNight = useRef(false);
  const lastTouch = useRef(0);

  const show = useCallback((next: boolean) => {
    if (asleepRef.current === next) return;
    asleepRef.current = next;
    if (next) closeOpenDialogs(document);
    setAsleep(next);
    window.dispatchEvent(
      new CustomEvent<NightEventDetail>(NIGHT_EVENT, {
        detail: { asleep: next },
      }),
    );
  }, []);

  const startMin = nightWindow?.startMin;
  const endMin = nightWindow?.endMin;
  useEffect(() => {
    const win =
      startMin === undefined || endMin === undefined
        ? null
        : { startMin, endMin };
    const offset = Date.parse(serverNow) - Date.now();
    if (lastTouch.current === 0) lastTouch.current = Date.now();
    const tick = () => {
      const at = new Date(Date.now() + offset);
      const night = isNightAt(at, win);
      const idle = Date.now() - lastTouch.current;
      setNow(at);
      if (night) {
        if (!wasNight.current || idle >= KIOSK_IDLE_MS) show(true);
      } else if (wasNight.current) {
        // The morning wakes it, and starts the day's idle wait afresh.
        lastTouch.current = Date.now();
        show(false);
      } else if (idle >= SCREENSAVER_IDLE_MS && !reminderShowing()) {
        show(true);
      }
      wasNight.current = night;
    };
    const touched = () => {
      lastTouch.current = Date.now();
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    window.addEventListener("pointerdown", touched, {
      passive: true,
      capture: true,
    });
    window.addEventListener("keydown", touched, { capture: true });
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pointerdown", touched, { capture: true });
      window.removeEventListener("keydown", touched, { capture: true });
    };
  }, [serverNow, startMin, endMin, show]);

  const wake = useCallback(() => {
    lastTouch.current = Date.now();
    show(false);
  }, [show]);

  if (!asleep) return null;
  const { time, date } = clockLines(now);
  return <Screensaver time={time} date={date} onWake={wake} />;
}
