"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NightScreen } from "@baumy/ui";
import { clockLines } from "@/lib/hub/view";
import { KIOSK_IDLE_MS } from "@/lib/kiosk/constants";
import {
  NIGHT_EVENT,
  isNightAt,
  type NightEventDetail,
  type NightWindow,
} from "@/lib/kiosk/night";
import { closeOpenDialogs } from "./idle-reset";

// Night mode (SPEC §8, issue #29). Inside the window (23:00-06:30 Berlin by
// default, `KIOSK_NIGHT_HOURS`) the kitchen screen dims to a sleeping Baumy
// and a clock. A touch wakes it; a minute untouched puts it back to sleep;
// the morning wakes it for good. It keeps the server's time the way the hub
// clock does (the server's `now` at render, plus how far this device's
// clock has moved since), so e2e's moved server clock moves it too.
//
// Its memory (asleep, the last touch, whether it was night at the last
// tick) lives in refs, so the kiosk home's 60-second refresh, which hands it
// a new `serverNow`, never puts a screen someone is using back to sleep.

export function NightMode({
  serverNow,
  window: nightWindow,
}: {
  /** The instant the shell was rendered at, ISO 8601. */
  serverNow: string;
  /** null: night mode is off. */
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
      setNow(at);
      if (!night) show(false);
      else if (
        !wasNight.current ||
        Date.now() - lastTouch.current >= KIOSK_IDLE_MS
      ) {
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
  return <NightScreen time={time} date={date} onWake={wake} />;
}
