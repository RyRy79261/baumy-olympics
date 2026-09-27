import type { ReactNode } from "react";
import { cx } from "./cx";
import { Sprite } from "./sprite";

// NEUTRAL PLACEHOLDERS for the kiosk's always-on pieces (SPEC §8, issue #29;
// issue #7 restyles them here): the night screen, and a one-line notice for
// the idle countdown or a screen that may go to sleep. The final sleeping
// Baumy is the owner's sprite sheet; `Sprite` keeps its API.

/**
 * Night mode: the whole screen dims to a sleeping Baumy and a clock. It is
 * one big button, so a touch anywhere wakes the screen and never lands on
 * whatever is underneath.
 */
export function NightScreen({
  time,
  date,
  onWake,
}: {
  /** "23:41". */
  time: string;
  /** "Sunday 27 September". */
  date: string;
  onWake: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="night-screen"
      aria-label={`Night mode, ${time}. Touch to wake the screen.`}
      onClick={onWake}
      className={cx(
        "fixed inset-0 z-50 flex h-dvh w-screen touch-manipulation flex-col items-center justify-center gap-8",
        "bg-neutral-950 text-neutral-200",
        "focus-visible:outline-4 focus-visible:-outline-offset-8 focus-visible:outline-neutral-200",
      )}
    >
      <Sprite
        name="baumy"
        state="sleeping"
        size={8}
        color="#262626"
        label="Baumy is asleep"
      />
      <span className="flex flex-col items-center">
        <span
          data-testid="night-time"
          className="font-mono text-8xl font-semibold tabular-nums"
        >
          {time}
        </span>
        <span className="text-xl text-neutral-300">{date}</span>
      </span>
      <span className="text-base text-neutral-300">Touch to wake</span>
    </button>
  );
}

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
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 mx-auto w-fit max-w-[90vw] rounded border border-neutral-900 bg-white px-4 py-3 text-base font-medium text-neutral-900 shadow"
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
      className="pointer-events-none fixed bottom-4 left-4 z-40 rounded border border-amber-800 bg-amber-50 px-2 py-1 text-sm font-medium text-amber-900"
    >
      {children}
    </span>
  );
}
