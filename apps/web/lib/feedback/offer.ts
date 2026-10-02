import type { ClientError } from "./client-errors";

// When the reporter offers "Report this bug" on its own (issue #133). Pure:
// the caller passes the time. The offer is optional and never blocks, and
// it is rate-limited so an error loop cannot keep putting it up:
//
//   - only an UNCAUGHT error (window.error, unhandledrejection) is offered;
//     console.error is too chatty (React warnings, our own handled
//     failures) and is only kept for the report, and an error boundary's
//     page has its own Report button;
//   - never while the reporter is open or the offer is already up;
//   - at most once every OFFER_GAP_MS;
//   - after "Not now", nothing for SNOOZE_MS.

export const OFFER_GAP_MS = 10 * 60_000;
export const SNOOZE_MS = 30 * 60_000;
/** The offer goes away by itself after this. */
export const OFFER_VISIBLE_MS = 20_000;

const OFFERED_SOURCES: ReadonlySet<string> = new Set([
  "window.error",
  "unhandledrejection",
]);

export interface OfferState {
  /** When the offer last went up; null if never. */
  lastOfferedAt: number | null;
  /** "Not now" holds further offers until then. */
  snoozedUntil: number | null;
}

export const NO_OFFER_YET: OfferState = {
  lastOfferedAt: null,
  snoozedUntil: null,
};

export function shouldOffer(
  error: Pick<ClientError, "source">,
  state: OfferState,
  now: number,
  busy: boolean,
): boolean {
  if (busy) return false;
  if (!OFFERED_SOURCES.has(error.source)) return false;
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return false;
  if (state.lastOfferedAt !== null && now - state.lastOfferedAt < OFFER_GAP_MS)
    return false;
  return true;
}

export function offered(state: OfferState, now: number): OfferState {
  return { ...state, lastOfferedAt: now };
}

export function snoozed(state: OfferState, now: number): OfferState {
  return { ...state, snoozedUntil: now + SNOOZE_MS };
}
