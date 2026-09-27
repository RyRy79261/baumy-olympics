"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The kitchen screen stays fresh without websockets (SPEC §8): it re-reads
// the page every 60 seconds and whenever it comes back into view. It waits
// while someone is in the middle of something (a dialog open, a field
// focused), so a refresh never pulls the page out from under them.

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
      if (!isBusy(document)) router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
