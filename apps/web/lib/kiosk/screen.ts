import { useSyncExternalStore } from "react";
import { forceCloseDialog } from "@baumy/ui";

// The kitchen screen: who holds it, and the one way to take it (issue #213).
//
// A holder is something mid-conversation that the screen should not be
// taken from (issue #132): a finger holding "Hold to talk", or Baumy
// transcribing, thinking or saving. Today only Baumy's speech bubble
// (components/baumy/baumy-sheet.tsx) holds it.
//
// Three things take the whole screen: the idle reset going home
// (components/kiosk/idle-reset.tsx), the raccoon screensaver
// (screensaver.tsx) and a full-screen reminder (reminders.tsx). Taking it
// closes every open dialog, even one whose form is sending (#174), and tells
// what is open without being a dialog (Baumy's bubble and its recording) to
// close through `onScreenTaken`. Which takeovers wait for whom is
// `SCREEN_RULES` below; nothing else decides it.
//
// Client-only state; the DOM is passed in, so it is tested against a fake
// document and window.

/** Why the kiosk takes the screen. */
export type Takeover =
  /** Untouched for the screen's idle minutes: forget the pick, go home. */
  | "idle-reset"
  /** The screensaver after its idle wait (5 minutes by day, a minute at
   * night once woken). */
  | "screensaver-idle"
  /** The screensaver at the start of the night window: at once. */
  | "nightfall"
  /** A full-screen reminder came up. */
  | "reminder";

export type ScreenRules = {
  /**
   * Whether a holder (Baumy mid-conversation) makes the takeover wait. The
   * waiting ones count their idle time again from when the hold ends; the
   * others take the screen even mid-sentence.
   */
  holdersDelay: Readonly<Record<Takeover, boolean>>;
  /**
   * Whether an open sheet whose form is sending makes the idle reset skip
   * its turn (and try again a wait later), the way a busy Baumy delays it.
   */
  sendingSheetDelaysIdle: boolean;
};

/** The kitchen screen's rules: the one place to change who waits for whom. */
export const SCREEN_RULES: Readonly<ScreenRules> = {
  holdersDelay: {
    "idle-reset": true,
    "screensaver-idle": true,
    nightfall: false,
    reminder: false,
  },
  // OPEN OWNER QUESTION (issue #213): should a sending log or note sheet (or
  // a PIN pad) delay the idle reset the way a busy Baumy does? Today it does
  // not: going home force-closes it (1f9d4e7e) and its answer is not shown.
  // Kept as it is until the owner rules; flip this to change it.
  sendingSheetDelaysIdle: false,
};

/**
 * Marks a `<dialog>` whose form is sending (set by the Dialog in @baumy/ui).
 * Only the kit's Dialog sets it: the dashboard's day sheet (a raw `<dialog>`
 * in components/kiosk/dashboard/month-calendar.tsx) and `KioskModal` never
 * do, so whoever flips `sendingSheetDelaysIdle` must mark those too if a
 * form in them can send.
 */
const SENDING_SHEET = "dialog[open][data-sending]";

/** Sent on the window when the kiosk takes the screen. */
const TAKEN_EVENT = "baumy:kiosk-cover";

const holders = new Set<string>();
const listeners = new Set<() => void>();

/** Hold the screen as `id` (or let go). Idempotent. */
export function holdScreen(id: string, held: boolean): void {
  if (holders.has(id) === held) return;
  if (held) holders.add(id);
  else holders.delete(id);
  for (const l of listeners) l();
}

/** Whether anything holds the screen. */
export function isScreenHeld(): boolean {
  return holders.size > 0;
}

export function subscribeScreenHeld(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether a holder makes `takeover` wait, as a hook (the rules' holder part
 * only: a sending sheet is checked when the takeover comes). Never held
 * while rendering on the server.
 */
export function useScreenHeld(takeover: Takeover): boolean {
  const waits = SCREEN_RULES.holdersDelay[takeover];
  return useSyncExternalStore(
    subscribeScreenHeld,
    () => waits && isScreenHeld(),
    () => false,
  );
}

/** Whether `takeover` has to wait right now. */
export function screenHeldFor(
  takeover: Takeover,
  doc: Document,
  rules: ScreenRules = SCREEN_RULES,
): boolean {
  if (rules.holdersDelay[takeover] && isScreenHeld()) return true;
  return (
    takeover === "idle-reset" &&
    rules.sendingSheetDelaysIdle &&
    doc.querySelector(SENDING_SHEET) !== null
  );
}

/**
 * Take the whole screen: close every open dialog (even one waiting on an
 * answer) and tell the rest to close. Returns false, taking nothing, if
 * something holds the screen against this takeover.
 */
export function takeScreen(
  takeover: Takeover,
  doc: Document,
  rules: ScreenRules = SCREEN_RULES,
): boolean {
  if (screenHeldFor(takeover, doc, rules)) return false;
  for (const dialog of doc.querySelectorAll("dialog[open]")) {
    forceCloseDialog(dialog as HTMLDialogElement);
  }
  doc.defaultView?.dispatchEvent(new Event(TAKEN_EVENT));
  return true;
}

/** Call `listener` each time the screen is taken; returns the unsubscribe. */
export function onScreenTaken(win: Window, listener: () => void): () => void {
  win.addEventListener(TAKEN_EVENT, listener);
  return () => win.removeEventListener(TAKEN_EVENT, listener);
}
