"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { refreshCookieLine } from "@/lib/hub/refresh";
import { isKioskAsleep, subscribeKioskAsleep } from "@/lib/kiosk/asleep";

// The kitchen screen stays fresh without websockets (SPEC §8): it re-reads
// the page every 60 seconds and whenever it comes back into view. It waits
// while someone is in the middle of something (a dialog open, a field
// focused), so a refresh never pulls the page out from under them.
//
// It does not re-read a screen nobody can see (issue #210): while the
// screensaver is up (lib/kiosk/asleep.ts) or the page is hidden. Each of
// those re-reads is a full server render, and a kitchen screen spends most of
// the day asleep. Waking re-reads at once, so the page is current the moment
// someone looks at it.
//
// Each of these re-reads sets a short-lived cookie first, so the server
// skips its 30-second cache of brain's shopping list (lib/hub/refresh.ts).

export const HUB_REFRESH_MS = 60_000;

/** True while a person is using the screen: a dialog or a field is open. */
export function isBusy(doc: Document): boolean {
  if (doc.querySelector("dialog[open]")) return true;
  const active = doc.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  );
}

export function AutoRefresh({
  intervalMs = HUB_REFRESH_MS,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (isBusy(document) || isKioskAsleep()) return;
      if (document.visibilityState === "hidden") return;
      document.cookie = refreshCookieLine();
      router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // Only the wake: going to sleep needs nothing.
    const onSleepChange = () => {
      if (!isKioskAsleep()) refresh();
    };
    const id = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = subscribeKioskAsleep(onSleepChange);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [router, intervalMs]);
  return null;
}
