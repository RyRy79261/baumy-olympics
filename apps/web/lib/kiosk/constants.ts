// Kiosk constants that client components need too (no Node imports here).

/** How long the screen waits, untouched, before it forgets who is acting
 * and goes home (and, at night, before it sleeps again after a wake). */
export const KIOSK_IDLE_MS = 60_000;

/** The last stretch of that wait, when the screen shows a countdown. */
export const KIOSK_IDLE_WARN_MS = 10_000;

/** Result codes that mean "show the PIN pad" on the kiosk. */
export const PIN_PROMPT_CODES: ReadonlySet<string> = new Set([
  "ATTESTATION_REQUIRED",
  "ATTESTATION_FAILED",
  "RATE_LIMITED",
]);

/** How long the screen waits, untouched, by day before the raccoon
 * screensaver comes on (ADR 0005 §6). */
export const SCREENSAVER_IDLE_MS = 5 * 60_000;

/**
 * How often the kitchen screen asks whether a reminder was posted, away from
 * the home page (whose own 60-second refresh brings reminders with it) and
 * while awake.
 */
export const REMINDER_POLL_MS = 60_000;

/**
 * Sent on `window` when something takes over the whole screen (a reminder,
 * the screensaver, the idle reset): whatever is open without being a
 * dialog, like Baumy's speech bubble and its recording, closes.
 */
export const KIOSK_COVER_EVENT = "baumy:kiosk-cover";
