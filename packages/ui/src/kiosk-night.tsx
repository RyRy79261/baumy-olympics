import type { ReactNode } from "react";

// The kiosk's always-on pieces in the pixel kit (SPEC §8, issue #29): a
// one-line notice for the idle countdown or a screen that may go to sleep.
// The night screen is the Screensaver now (screensaver.tsx, ADR 0005 §6).

/**
 * A short notice pinned to the bottom of the kiosk (a polite live region):
 * "Going back to the start in 8 s", "The screen may go to sleep".
 */
export function KioskNotice({
  children,
  "data-testid": testId,
}: {
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <p
      role="status"
      data-testid={testId}
      className="pixel-frame pixel-frame-4 pointer-events-none fixed inset-x-0 bottom-4 z-40 mx-auto w-fit max-w-[90vw] bg-bm-raised px-5 py-3 text-xl text-bm-text [--pf:var(--color-bm-text)]"
    >
      {children}
    </p>
  );
}

/**
 * A small tag for something the household should know about the device
 * itself ("Screen may sleep"). A polite live region, pinned to the bottom
 * left corner so it never moves the avatar bar when it comes and goes (a
 * shift under a finger would turn a tap into a miss), and it never catches a
 * touch.
 */
export function KioskIndicator({
  children,
  "data-testid": testId,
}: {
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <span
      role="status"
      data-testid={testId}
      className="pixel-frame pointer-events-none fixed bottom-4 left-4 z-40 bg-bm-amber/15 px-3 py-1 font-label text-sm font-bold text-bm-amber uppercase [--pf:var(--color-bm-amber)]"
    >
      {children}
    </span>
  );
}
