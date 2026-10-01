import { BaumyCat } from "./baumy-cat";
import {
  BAUMY_STATES,
  SPRITE_MOTION,
  STATE_MARK,
  type SpriteState,
} from "./baumy-states";
import { cx } from "./cx";

// A sprite by name (SPEC §7). "baumy" is the cat (BaumyCat), in its state;
// any other name is drawn as a pixel tile with its initial (members are
// shown by MemberCharacter). `size` is the integer scale of a 16px cell.

export { BAUMY_STATES, SPRITE_MOTION, type SpriteState };

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
  if (name === "baumy") {
    return (
      <BaumyCat
        state={state}
        // The cat is 34 × 32 art pixels, about two 16px cells.
        scale={Math.max(1, Math.round(size / 2))}
        label={label}
        className={className}
      />
    );
  }
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
        "pixel-frame relative inline-flex shrink-0 items-center justify-center font-display text-bm-ink uppercase [--pf:var(--color-bm-ink)]",
        motion,
        className,
      )}
      style={{
        width: px,
        height: px,
        fontSize: Math.max(8, Math.round(px / 3)),
        backgroundColor: color ?? "var(--color-bm-dim)",
      }}
    >
      {name.slice(0, 1)}
      {mark ? (
        <span
          aria-hidden
          className="absolute top-0 right-0 bg-bm-text px-1 font-display text-[10px] leading-4 text-bm-ink"
        >
          {mark}
        </span>
      ) : null}
    </span>
  );
}
