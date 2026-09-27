import { cx } from "./cx";

// PLACEHOLDER for the pixel sprites (SPEC §7, issue #7): the API the real
// `<Sprite sheet frames fps />` will keep, drawn as a coloured tile with the
// sprite's initial. `name` is what `members.avatar_sprite` stores; `state`
// is the animation (Baumy has seven, SPEC §3.6; avatars idle); `size` is the
// integer scale of a 16px cell.
//
// Motion: each moving state gets a `motion-safe:` animation, so under
// `prefers-reduced-motion` the sprite stands still in its state (and the
// app's global kill switch stops anything else). Issue #7 swaps these for
// the sheet's frames with CSS `steps()`, keeping the same rule.

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

/** The placeholder animation per state; none = still. */
export const SPRITE_MOTION: Readonly<Record<SpriteState, string | null>> = {
  idle: null,
  listening: "motion-safe:animate-pulse",
  thinking: "motion-safe:animate-pulse",
  talking: "motion-safe:animate-bounce",
  happy: "motion-safe:animate-bounce",
  sad: null,
  sleeping: null,
};

/** A second cue per state that is not motion, so reduced motion still reads. */
const STATE_MARK: Readonly<Record<SpriteState, string | null>> = {
  idle: null,
  listening: "…",
  thinking: "?",
  talking: "!",
  happy: "+",
  sad: "×",
  sleeping: "z",
};

export function Sprite({
  name,
  state = "idle",
  size = 2,
  color,
  label,
  className,
}: {
  name: string;
  state?: SpriteState;
  /** How many times the 16px cell is scaled. */
  size?: 1 | 2 | 3 | 4 | 6 | 8;
  /** The member's colour, as the tile background. */
  color?: string;
  /** Accessible name; without it the sprite is decorative. */
  label?: string;
  className?: string;
}) {
  const px = 16 * size;
  const motion = SPRITE_MOTION[state];
  const mark = STATE_MARK[state];
  return (
    <span
      data-sprite={name}
      data-state={state}
      data-motion={motion ? "animated" : "still"}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded border border-neutral-900 font-bold uppercase text-white",
        motion,
        className,
      )}
      style={{
        width: px,
        height: px,
        fontSize: px / 2,
        backgroundColor: color ?? "#525252",
      }}
    >
      {name.slice(0, 1)}
      {mark ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 rounded-full border border-neutral-900 bg-white px-1 text-xs leading-4 text-neutral-900"
        >
          {mark}
        </span>
      ) : null}
    </span>
  );
}
