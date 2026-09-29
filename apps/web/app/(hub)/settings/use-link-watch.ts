"use client";

import { useEffect, useRef } from "react";

// While a Telegram link code is live (issue #108), /settings re-reads itself
// so it turns into "linked" soon after the member taps Start in Telegram,
// with no websocket: every few seconds, and at once when the tab comes back
// into focus (the member usually returns from the Telegram app). It stops at
// the code's expiry, since nothing can link after that.

export const LINK_POLL_MS = 3_000;

export function useLinkWatch({
  active,
  until,
  refresh,
  intervalMs = LINK_POLL_MS,
}: {
  /** True while a code is shown and the account has not linked yet. */
  active: boolean;
  /** Epoch ms of the code's expiry. */
  until: number;
  refresh: () => void;
  intervalMs?: number;
}) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    const left = until - Date.now();
    if (!active || left <= 0) return;
    const tick = () => latest.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const id = window.setInterval(tick, intervalMs);
    const stop = window.setTimeout(() => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    }, left);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, until, intervalMs]);
}
