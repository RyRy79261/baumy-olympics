// "Someone here just scored" (issue #111): the "+N" moment. Whatever shows
// the score pop announces it, and the character of whoever is acting on
// this screen (the hub's header, the kitchen's picked member) plays its
// emote pose once (components/members/score-emote.tsx). Client-side only,
// through one window event, so neither side knows the other.

export const SCORED_EVENT = "baumy:scored";

/** Tell this screen's acting character that points were just scored. */
export function announceScore(points: number): void {
  if (typeof window === "undefined" || points <= 0) return;
  window.dispatchEvent(new CustomEvent(SCORED_EVENT, { detail: { points } }));
}

/** Call `onScore` on every announcement; returns the unsubscribe. */
export function onScore(onScoreFn: () => void): () => void {
  window.addEventListener(SCORED_EVENT, onScoreFn);
  return () => window.removeEventListener(SCORED_EVENT, onScoreFn);
}
