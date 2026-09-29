import type { AvatarImage } from "@baumy/types";
import type { CSSProperties } from "react";
import { cx } from "./cx";
import { Housemate } from "./housemate";

// How a member is drawn, everywhere (issue #111): the gallery sprite they
// picked, or, until they pick one, their parametric Housemate. One
// component, so the header, the kiosk's avatar bar and acting chip, the
// reminder faces, the dashboard and the admin pages all agree.
//
// `scale` means what it means for the Housemate (a 17px-tall character
// drawn `scale` times), so a slot keeps its size whichever is drawn. A
// sprite is drawn at the whole-number multiple (or whole-number fraction)
// of its own pixels that comes closest to that height, with
// `image-rendering: pixelated`, so its pixels stay square and crisp.

/** The Housemate's height in its own pixels (packages/ui housemate.tsx). */
export const HOUSEMATE_HEIGHT_PX = 17;

const FACTORS = [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The factor to draw a sprite `height` pixels tall at, for a slot `target`
 * pixels tall: of 1/4 … 8, the one whose result is closest in ratio.
 */
export function spriteFactor(height: number, target: number): number {
  let best = 1;
  let off = Infinity;
  for (const f of FACTORS) {
    const d = Math.abs(Math.log((height * f) / target));
    if (d < off - 1e-9) {
      best = f;
      off = d;
    }
  }
  return best;
}

export function MemberCharacter({
  image,
  avatar,
  memberId = "",
  scale = 3,
  label,
  bob = false,
  className,
  style,
}: {
  /** Their gallery sprite, or null/undefined for the drawn character. */
  image?: AvatarImage | null;
  /** What `members.avatar` holds, for the drawn character. */
  avatar?: unknown;
  memberId?: string;
  /** The Housemate's scale; the sprite fills the same height. */
  scale?: number;
  /** Accessible name; without it the character is decorative. */
  label?: string;
  /** Bob gently (the reminder's "not seen yet"); motion-safe only. */
  bob?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  if (!image) {
    return (
      <Housemate
        avatar={avatar}
        memberId={memberId}
        scale={scale}
        label={label}
        bob={bob}
        className={className}
        style={style}
      />
    );
  }
  const f = spriteFactor(image.height, HOUSEMATE_HEIGHT_PX * scale);
  return (
    <span
      data-member-sprite
      className={cx(
        "inline-block shrink-0",
        bob && "motion-safe:animate-pixel-bob",
        className,
      )}
      style={style}
    >
      {/* A plain <img>: the proxy is same-origin and cookie-gated, and a
          56px sprite must not be resampled. */}
      <img
        src={image.src}
        width={Math.max(1, Math.round(image.width * f))}
        height={Math.max(1, Math.round(image.height * f))}
        alt={label ?? ""}
        aria-hidden={label ? undefined : true}
        draggable={false}
        className="block"
        style={{ imageRendering: "pixelated" }}
      />
    </span>
  );
}
