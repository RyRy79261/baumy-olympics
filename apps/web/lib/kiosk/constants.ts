// Kiosk constants that client components need too (no Node imports here).

/** How long the screen waits, untouched, before it forgets who is acting. */
export const KIOSK_IDLE_MS = 60_000;

/** Result codes that mean "show the PIN pad" on the kiosk. */
export const PIN_PROMPT_CODES: ReadonlySet<string> = new Set([
  "ATTESTATION_REQUIRED",
  "ATTESTATION_FAILED",
  "RATE_LIMITED",
]);
