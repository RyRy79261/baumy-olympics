// Baumy's states (SPEC §3.6), what `lib/ai/mood.ts` moves between, and how
// each one moves. Shared by the cat (baumy-cat.tsx) and Sprite.

/** Baumy's states, in SPEC §3.6 order. */
export const BAUMY_STATES = [
  "idle",
  "listening",
  "thinking",
  "talking",
  "happy",
  "sad",
  "sleeping",
] as const;

export type SpriteState = (typeof BAUMY_STATES)[number];

/**
 * The whole sprite's motion per state (the frames move on their own); none
 * = it stays put. Always `motion-safe:`, so under `prefers-reduced-motion`
 * the sprite stands still in its state (the app's global kill switch stops
 * anything else). The keyframes are in app/globals.css.
 */
export const SPRITE_MOTION: Readonly<Record<SpriteState, string | null>> = {
  idle: null,
  listening: "motion-safe:animate-pixel-bob",
  thinking: "motion-safe:animate-pixel-bob",
  talking: "motion-safe:animate-pixel-hop",
  happy: "motion-safe:animate-pixel-hop",
  sad: null,
  sleeping: null,
};

/** A second cue per state that is not motion, so reduced motion still reads. */
export const STATE_MARK: Readonly<Record<SpriteState, string | null>> = {
  idle: null,
  listening: "…",
  thinking: "?",
  talking: "!",
  happy: "+",
  sad: "×",
  sleeping: "z",
};
