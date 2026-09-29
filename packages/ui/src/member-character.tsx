import type { AvatarImage, AvatarPose, AvatarSprites } from "@baumy/types";
import type { CSSProperties } from "react";
import { cx } from "./cx";
import { Housemate } from "./housemate";

// How a member is drawn, everywhere (issue #111): the gallery character they
// picked, or, until they pick one, their parametric Housemate. One
// component, so the header, the kiosk's avatar bar and acting chip, the
// reminder faces, the dashboard, the scoreboard and the admin pages agree.
//
// `scale` means what it means for the Housemate (a 17px-tall character
// drawn `scale` times), so a slot keeps its size whichever is drawn. A set
// is drawn at the whole-number multiple (or whole-number fraction) of its
// idle pose's pixels that comes closest to that height, the same factor for
// every pose, with `image-rendering: pixelated`, so its pixels stay square.
//
// A set has an idle pose and maybe walk and emote (owner ruling
// 2026-09-29). `pose` picks one to hold (the scoreboard's leader emotes);
// `moment` plays one once as it mounts, over idle: "emote" for 2 seconds (a
// score, a "seen it"), or "walk-in" (someone taps in on the kiosk), which
// under reduced motion is just idle. A pose the set lacks is idle.

/** The Housemate's height in its own pixels (packages/ui housemate.tsx). */
export const HOUSEMATE_HEIGHT_PX = 17;

const FACTORS = [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Small slots show a bust, not the whole body: when the whole idle pose
 * would be drawn no taller than this, the top `BUST_FRACTION` of it (head
 * and shoulders) is drawn instead, bigger. It is the same cleaned image,
 * cropped as it is drawn; nothing new is stored or drawn.
 */
export const BUST_MAX_PX = 32;
export const BUST_FRACTION = 0.45;

/**
 * How a set is drawn in a slot `target` pixels tall: the factor, and the
 * rows of each pose to show (null for all of them, else the bust's).
 */
export function spriteFit(
  height: number,
  target: number,
): { f: number; rows: number | null } {
  const full = spriteFactor(height, target);
  if (height * full > BUST_MAX_PX) return { f: full, rows: null };
  const rows = Math.ceil(height * BUST_FRACTION);
  return { f: spriteFactor(rows, target), rows };
}

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

export type CharacterMoment = "emote" | "walk-in";

function Pose({
  image,
  f,
  label,
  className,
  pose,
}: {
  image: AvatarImage;
  f: number;
  label?: string;
  className?: string;
  pose: AvatarPose;
}) {
  return (
    // A plain <img>: the proxy is same-origin and cookie-gated, and a small
    // sprite must not be resampled.
    <img
      src={image.src}
      data-pose={pose}
      width={Math.max(1, Math.round(image.width * f))}
      height={Math.max(1, Math.round(image.height * f))}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={cx("block", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export function MemberCharacter({
  sprites,
  avatar,
  memberId = "",
  scale = 3,
  label,
  bob = false,
  pose = "idle",
  moment,
  className,
  style,
}: {
  /** Their gallery set, or null/undefined for the drawn character. */
  sprites?: AvatarSprites | null;
  /** What `members.avatar` holds, for the drawn character. */
  avatar?: unknown;
  memberId?: string;
  /** The Housemate's scale; the sprite fills the same height. */
  scale?: number;
  /** Accessible name; without it the character is decorative. */
  label?: string;
  /** Bob gently (the reminder's "not seen yet"); motion-safe only. */
  bob?: boolean;
  /** The pose to hold; idle when the set has no such pose. */
  pose?: AvatarPose;
  /** A pose to play once as it mounts, over the one held. */
  moment?: CharacterMoment;
  className?: string;
  style?: CSSProperties;
}) {
  if (!sprites) {
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
  const { f, rows } = spriteFit(
    sprites.idle.height,
    HOUSEMATE_HEIGHT_PX * scale,
  );
  const held = (pose !== "idle" && sprites[pose]) || sprites.idle;
  const heldPose: AvatarPose = held === sprites.idle ? "idle" : pose;
  const extra =
    moment === "emote"
      ? sprites.emote
      : moment === "walk-in"
        ? sprites.walk
        : null;
  return (
    <span
      data-member-sprite
      data-bust={rows !== null ? true : undefined}
      data-moment={extra ? moment : undefined}
      className={cx(
        "relative inline-block shrink-0",
        rows !== null && "overflow-hidden",
        bob && "motion-safe:animate-pixel-bob",
        className,
      )}
      style={
        rows !== null
          ? {
              width: Math.max(1, Math.round(sprites.idle.width * f)),
              height: Math.max(1, Math.round(rows * f)),
              ...style,
            }
          : style
      }
    >
      <Pose
        image={held}
        f={f}
        label={label}
        pose={heldPose}
        className={cx(
          rows !== null && "max-w-none",
          moment === "walk-in" &&
            extra &&
            "motion-safe:animate-pose-after-walk",
        )}
      />
      {extra ? (
        <Pose
          image={extra}
          f={f}
          pose={moment === "emote" ? "emote" : "walk"}
          className={cx(
            "absolute left-0 max-w-none",
            rows !== null ? "top-0" : "bottom-0",
            moment === "emote"
              ? "animate-pose-flash"
              : "hidden motion-safe:block motion-safe:animate-pose-walk-in",
          )}
        />
      ) : null}
    </span>
  );
}
