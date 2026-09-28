import type { ReactNode } from "react";
import { cx } from "./cx";
import { BaumyCat } from "./baumy-cat";

// The kiosk's always-on pieces in the pixel kit (SPEC §8, issue #29; ADR
// 0005 §6): the night screen (a dim night room with a sleeping Baumy and a
// big dim clock), and a one-line notice for the idle countdown or a screen
// that may go to sleep.

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
        "bg-[linear-gradient(180deg,#07040c_0%,#120a1d_60%,#1a0d18_100%)] text-[#3d2d57]",
        "focus-visible:outline-4 focus-visible:-outline-offset-8 focus-visible:outline-bm-dim",
      )}
    >
      <BaumyCat
        state="sleeping"
        scale={4}
        label="Baumy is asleep"
        className="opacity-70"
      />
      <span className="flex flex-col items-center">
        <span
          data-testid="night-time"
          className="font-display text-7xl text-[#3d2d57] [text-shadow:0_0_30px_rgb(143_125_255/0.2)] sm:text-8xl"
        >
          {time}
        </span>
        <span className="mt-4 font-label text-xl font-bold text-[#3d2d57] uppercase">
          {date}
        </span>
      </span>
      <span className="font-display text-base text-bm-dim">Touch to wake</span>
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
      className="pixel-frame pixel-frame-4 pointer-events-none fixed inset-x-0 bottom-4 z-40 mx-auto w-fit max-w-[90vw] bg-bm-raised px-5 py-3 text-xl text-bm-text [--pf:var(--color-bm-text)]"
    >
      {children}
    </p>
  );
}

/**
 * A small tag for something the household should know about the device
 * itself ("Screen may sleep"). A polite live region, pinned bottom left just
 * above the footer nav (ADR 0005), so it never covers a nav label or moves
 * anything when it comes and goes (a shift under a finger would turn a tap
 * into a miss), and it never catches a touch.
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
      className="pixel-frame pointer-events-none fixed bottom-[100px] left-6 z-40 bg-bm-amber/15 px-3 py-1 font-label text-sm font-bold text-bm-amber uppercase [--pf:var(--color-bm-amber)]"
    >
      {children}
    </span>
  );
}
