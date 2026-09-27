import { cx } from "./cx";

// PLACEHOLDER for the pixel sprites (SPEC §7, issue #7): the API the real
// `<Sprite sheet frames fps />` will keep, drawn as a coloured tile with the
// sprite's initial. `name` is what `members.avatar_sprite` stores; `state`
// is the animation (Baumy has seven; avatars idle); `size` is the integer
// scale of a 16px cell.

export type SpriteState =
  "idle" | "happy" | "sad" | "sleep" | "listen" | "think" | "celebrate";

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
  size?: 1 | 2 | 3 | 4;
  /** The member's colour, as the tile background. */
  color?: string;
  /** Accessible name; without it the sprite is decorative. */
  label?: string;
  className?: string;
}) {
  const px = 16 * size;
  return (
    <span
      data-sprite={name}
      data-state={state}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded border border-neutral-900 font-bold uppercase text-white",
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
    </span>
  );
}
