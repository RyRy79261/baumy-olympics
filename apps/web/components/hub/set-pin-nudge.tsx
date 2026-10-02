"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

// The nudge after joining (issue #145): a member who has no personal PIN
// yet sees, on the hub home, where to set it, until they do. Nobody is asked
// for a PIN at the kitchen screen without having heard of it first (Felix's
// case: the cat asked for a PIN he never set). Issue #152: a slim strip
// across the top, never a whole card, and its × hides it for this member on
// this device (localStorage), so a member who chooses not to set one is not
// nagged on every visit.

/** The localStorage key that remembers one member hid the strip. */
export function pinNudgeKey(memberId: string): string {
  return `baumy:pin-nudge-hidden:${memberId}`;
}

const listeners = new Set<() => void>();
/** Hidden on this page load, for when storage is blocked. */
const hiddenThisVisit = new Set<string>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function isHidden(memberId: string): boolean {
  if (hiddenThisVisit.has(memberId)) return true;
  try {
    return window.localStorage.getItem(pinNudgeKey(memberId)) === "1";
  } catch {
    // Storage blocked (a private window): show it, the × hides it for now.
    return false;
  }
}

export function SetPinNudge({ memberId }: { memberId: string }) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => isHidden(memberId),
    // The server cannot read this device's storage: render nothing, so a
    // member who hid it never sees it flash in.
    () => true,
  );
  if (hidden) return null;
  const hide = () => {
    try {
      window.localStorage.setItem(pinNudgeKey(memberId), "1");
    } catch {
      // Not stored; it still goes away until the page is loaded again.
    }
    hiddenThisVisit.add(memberId);
    for (const l of listeners) l();
  };
  return (
    <div
      data-testid="set-pin-nudge"
      className="pixel-frame mb-4 flex items-center gap-3 bg-bm-surface py-1 pr-1 pl-4 text-base text-bm-text"
    >
      <p className="min-w-0 flex-1">
        Set your personal PIN for the kitchen iPad
        <span aria-hidden="true" className="text-bm-muted">
          {" · "}
        </span>{" "}
        <Link href="/settings#pin" className="underline">
          Set it
        </Link>
      </p>
      <button
        type="button"
        onClick={hide}
        aria-label="Hide the PIN reminder"
        className="inline-flex size-11 shrink-0 items-center justify-center text-lg text-bm-muted hover:text-bm-text"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
