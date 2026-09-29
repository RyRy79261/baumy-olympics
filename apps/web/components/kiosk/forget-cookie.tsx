"use client";

import { useEffect } from "react";

// Forgets a one-shot cookie as soon as the page that used it is on screen:
// the kiosk's walk-in (lib/kiosk/cookies.ts `KIOSK_WALK_IN_COOKIE`) plays
// once for the tap that set it, not again on the next visit to Home.

export function ForgetCookie({ name }: { name: string }) {
  useEffect(() => {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Strict; Secure`;
  }, [name]);
  return null;
}
