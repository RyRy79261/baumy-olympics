import { useSyncExternalStore } from "react";

// Whether something on the kitchen screen is mid-conversation (issue #132):
// a finger holding "Hold to talk", or Baumy transcribing, thinking or saving.
// The idle reset and the screensaver wait while it is, so a long hold and a
// slow reply never lose the pick or the answer; they start counting again
// from when it ends. Client-only state, one flag per holder.

const holders = new Set<string>();
const listeners = new Set<() => void>();

/** Mark `id` as busy (or not). Idempotent. */
export function setKioskBusy(id: string, busy: boolean): void {
  if (holders.has(id) === busy) return;
  if (busy) holders.add(id);
  else holders.delete(id);
  for (const l of listeners) l();
}

export function isKioskBusy(): boolean {
  return holders.size > 0;
}

export function subscribeKioskBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `isKioskBusy()` as a hook; never busy while rendering on the server. */
export function useKioskBusy(): boolean {
  return useSyncExternalStore(subscribeKioskBusy, isKioskBusy, () => false);
}
