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
