"use client";

import { useEffect } from "react";
import { KIOSK_WALK_IN_COOKIE } from "@/lib/kiosk/cookies";

// Forgets the kiosk's one-shot walk-in cookie (lib/kiosk/cookies.ts) as soon
// as the dashboard that used it is on screen, so the walk plays once for the
// tap that set it, not again on the next visit to Home.

export function ForgetWalkIn() {
  useEffect(() => {
    document.cookie = `${KIOSK_WALK_IN_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict; Secure`;
  }, []);
  return null;
}
