"use client";

import { useEffect, useRef, useState } from "react";

// While a Telegram link code is on screen (issues #108, #118), /settings asks
// the server where the member's newest code stands, so the card turns into
// "Linked" soon after the member taps Start in Telegram, with no websocket:
// every few seconds, and at once when the tab comes back into focus (the
// member usually returns from the Telegram app).
//
// - It stops as soon as the server says the code is used or expired.
// - It is timed on the server's seconds left, never on the device clock: a
//   timer fires when the server said the code would expire (moved by every
//   answer), and asks once more then, so a phone whose clock is off neither
//   stops early nor keeps a dead code on screen. If that last ask fails, the
//   code is taken as expired.

export const LINK_POLL_MS = 3_000;

export type LinkPhase = "waiting" | "used" | "expired";

/** The server's answer, or null when the read failed. */
export type LinkCheck = () => Promise<{
  state: LinkPhase;
  secondsLeft: number;
} | null>;

export function useLinkWatch({
  code,
  secondsLeft,
  check,
  intervalMs = LINK_POLL_MS,
}: {
  /** The code on screen, or null when there is none to watch. */
  code: string | null;
  /** The server's seconds left for it when it was made. */
  secondsLeft: number;
  check: LinkCheck;
  intervalMs?: number;
}): LinkPhase | null {
  const latest = useRef(check);
  useEffect(() => {
    latest.current = check;
  });
  // Keyed on the code, so a new code starts out waiting.
  const [settled, setSettled] = useState<{
    code: string;
    phase: LinkPhase;
  } | null>(null);

  useEffect(() => {
    if (code === null) return;
    let done = false;
    let expiry: number | undefined;

    function stop() {
      done = true;
      window.clearInterval(id);
      window.clearTimeout(expiry);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", onVisible);
    }
    const settle = (phase: LinkPhase) => {
      if (done) return;
      stop();
      setSettled({ code, phase });
    };
    const arm = (seconds: number) => {
      window.clearTimeout(expiry);
      expiry = window.setTimeout(atExpiry, Math.max(0, seconds) * 1000);
    };
    async function ask() {
      const answer = await latest.current().catch(() => null);
      if (done || !answer) return answer;
      if (answer.state === "waiting") arm(answer.secondsLeft);
      else settle(answer.state);
      return answer;
    }
    function poll() {
      void ask();
    }
    async function atExpiry() {
      if (!(await ask())) settle("expired");
    }
    function onVisible() {
      if (document.visibilityState === "visible") poll();
    }

    const id = window.setInterval(poll, intervalMs);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", onVisible);
    arm(secondsLeft);
    return stop;
  }, [code, secondsLeft, intervalMs]);

  if (code === null) return null;
  return settled?.code === code ? settled.phase : "waiting";
}
