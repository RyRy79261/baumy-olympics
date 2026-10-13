// Whether the kitchen screen is asleep under the raccoon screensaver (issue
// #210): at night, or after the day's idle minutes. The screensaver
// (components/kiosk/screensaver.tsx) is the only writer; the home and Shop
// pages' refresh (components/hub/auto-refresh.tsx) reads it, so a screen
// nobody can see does not re-render every minute, and refreshes once when it
// wakes. A store rather than only `NIGHT_EVENT`: a page that mounts while the
// screen is already asleep (the idle reset going home at night) must know at
// once, without waiting for an event that has already fired. Client-only.

let asleep = false;
const listeners = new Set<() => void>();

/** Record whether the screen is asleep. Idempotent. */
export function setKioskAsleep(next: boolean): void {
  if (asleep === next) return;
  asleep = next;
  for (const l of listeners) l();
}

export function isKioskAsleep(): boolean {
  return asleep;
}

/** Called after every change; returns the unsubscribe. */
export function subscribeKioskAsleep(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
