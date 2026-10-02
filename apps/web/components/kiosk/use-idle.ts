"use client";

import { useEffect, useRef, useState } from "react";

// Calls `onIdle` after `ms` with no touch, click, key or scroll, while
// `active`. Any interaction starts the wait again. SPEC §8: the kiosk
// forgets who is acting after 60 seconds idle, so the next person cannot act
// as them.
//
// Robust against the iPad (issue #29): the wait is measured from the last
// touch's timestamp, and a one-second tick compares against it, instead of
// trusting one long setTimeout. Safari pauses timers while the screen is
// off or the page is hidden, so a single timeout could fire long after the
// minute, or not at all before the next person taps; the tick, and a check
// the moment the page is visible again, catch up at once. After it fires it
// starts a new wait, so if the reset did not take (offline, say) it tries
// again a minute later.
//
// With `warnMs`, it also returns the whole seconds left during the last
// `warnMs` of the wait (null otherwise), for a countdown.

// A release counts too: a hold (Baumy's "Hold to talk", issue #132) is
// touched when the finger lifts, not only when it went down.
const EVENTS = [
  "pointerdown",
  "pointerup",
  "keydown",
  "touchstart",
  "touchend",
  "wheel",
] as const;

/** How often the wait is checked. */
export const IDLE_TICK_MS = 1_000;

export function useIdle(
  active: boolean,
  ms: number,
  onIdle: () => void,
  warnMs = 0,
): number | null {
  const callback = useRef(onIdle);
  useEffect(() => {
    callback.current = onIdle;
  });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const check = () => {
      const left = last + ms - Date.now();
      if (left <= 0) {
        last = Date.now();
        setSecondsLeft(null);
        callback.current();
        return;
      }
      setSecondsLeft(left <= warnMs ? Math.ceil(left / 1000) : null);
    };
    const touched = () => {
      last = Date.now();
      setSecondsLeft(null);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const tick = window.setInterval(check, IDLE_TICK_MS);
    for (const e of EVENTS) {
      window.addEventListener(e, touched, { passive: true, capture: true });
    }
    // A scroll inside a panel does not bubble, so listen in the capture phase.
    document.addEventListener("scroll", touched, {
      passive: true,
      capture: true,
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      setSecondsLeft(null);
      window.clearInterval(tick);
      for (const e of EVENTS) {
        window.removeEventListener(e, touched, { capture: true });
      }
      document.removeEventListener("scroll", touched, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, ms, warnMs]);

  return active ? secondsLeft : null;
}
