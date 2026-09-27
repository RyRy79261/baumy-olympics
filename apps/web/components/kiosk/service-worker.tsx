"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, whose only job is the offline page (SPEC §8: no
 * offline data). Registered from the kiosk shell, the installed app's
 * start page; a browser without service workers just goes without.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
