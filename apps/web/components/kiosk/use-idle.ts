"use client";

import { useEffect, useRef } from "react";

// Calls `onIdle` once after `ms` with no touch, click or key, while `active`.
// Any interaction starts the wait again. SPEC §8: the kiosk forgets who is
// acting after 60 seconds idle, so the next person cannot act as them.

const EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

export function useIdle(active: boolean, ms: number, onIdle: () => void) {
  const callback = useRef(onIdle);
  useEffect(() => {
    callback.current = onIdle;
  });

  useEffect(() => {
    if (!active) return;
    let timer = setTimeout(() => callback.current(), ms);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), ms);
    };
    for (const e of EVENTS) {
      window.addEventListener(e, restart, { passive: true });
    }
    return () => {
      clearTimeout(timer);
      for (const e of EVENTS) window.removeEventListener(e, restart);
    };
  }, [active, ms]);
}
