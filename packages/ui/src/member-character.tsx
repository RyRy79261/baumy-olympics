import type { AvatarImage, AvatarPose, AvatarSprites } from "@baumy/types";
import type { CSSProperties } from "react";
import { cx } from "./cx";

// How a member is shown, everywhere (issue #111): the gallery character they
// picked, or, until they pick one, a plain tile with their initial in their
// colour (issue #116: the app never draws a person). One component, so the
// header, the kiosk's avatar bar and acting chip, the reminder faces, the
// dashboard, the scoreboard and the admin pages agree.
//
// A slot is `CHARACTER_SLOT_PX * scale` pixels tall, whichever is shown. A
// set is drawn at the whole-number multiple (or whole-number fraction) of
// its idle pose's pixels that comes closest to that height, the same factor
// for every pose, with `image-rendering: pixelated`, so its pixels stay
// square. The initial tile is a square of that height.
//
// A set has an idle pose and maybe walk and emote (owner ruling
// 2026-09-29). `pose` picks one to hold (the scoreboard's leader emotes);
// `moment` plays one once as it mounts, over idle: "emote" for 2 seconds (a
// score, a "seen it"), or "walk-in" (someone taps in on the kiosk), which
// under reduced motion is just idle. A pose the set lacks is idle.

/** A slot's height at scale 1, in CSS pixels. */
export const CHARACTER_SLOT_PX = 17;

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
      // Whole-number scales keep square pixels; below 1× the browser's
      // smoothing averages each block instead of dropping rows, so thin
      // outlines survive in the smallest slots.
      style={{ imageRendering: f < 1 ? "auto" : "pixelated" }}
    />
  );
}

/** The first letter of a name, as the initial tile shows it. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

/** The kit's ink and text colours (app/globals.css `--color-bm-ink`, `-text`). */
const INK = "#0b0712";
const TEXT = "#f7ecff";
const RAISED = "#251838";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** What the initial tile is painted with, for one member colour. */
export interface InitialTileColours {
  background: string;
  letter: string;
  frame: string;
}

/**
 * The initial tile's colours (issue #116): the member's colour as the
 * ground with the ink or the text colour on it, whichever reads better.
 * A colour neither reaches 4.5:1 on (a mid grey), or one that is not a
 * `#rrggbb`, goes in the frame only, with light text on the raised plum.
 */
export function initialTileColours(colour: string): InitialTileColours {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) {
    return { background: RAISED, letter: TEXT, frame: colour };
  }
  const onInk = contrastRatio(colour, INK);
  const onText = contrastRatio(colour, TEXT);
  if (Math.max(onInk, onText) < 4.5) {
    return { background: RAISED, letter: TEXT, frame: colour };
  }
  return {
    background: colour,
    letter: onInk >= onText ? INK : TEXT,
    frame: INK,
  };
}

/**
 * A member with no gallery character: a pixel-frame tile with their
 * initial on their colour, at least 4.5:1. Text only.
 */
function InitialTile({
  name,
  colour,
  px,
  label,
  bob,
  className,
  style,
}: {
  name: string;
  colour: string;
  px: number;
  label?: string;
  bob: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const paint = initialTileColours(colour);
  return (
    <span
      data-member-initial
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={cx(
        "pixel-frame inline-flex shrink-0 items-center justify-center font-display leading-none uppercase",
        bob && "motion-safe:animate-pixel-bob",
        className,
      )}
      style={{
        width: px,
        height: px,
        color: paint.letter,
        backgroundColor: paint.background,
        fontSize: Math.max(8, Math.round(px * 0.5)),
        ["--pf" as string]: paint.frame,
        ["--pf-w" as string]: `${px >= 48 ? 3 : 2}px`,
        ...style,
      }}
    >
      {initialOf(name)}
    </span>
  );
}

export function MemberCharacter({
  sprites,
  name = "",
  colour = "var(--color-bm-muted)",
  scale = 3,
  label,
  bob = false,
  pose = "idle",
  moment,
  className,
  style,
}: {
  /** Their gallery set, or null/undefined for the initial tile. */
  sprites?: AvatarSprites | null;
  /** Their display name: the initial tile shows its first letter. */
  name?: string;
  /** Their colour (`members.color`): the initial tile's ground. */
  colour?: string;
  /** The slot is `CHARACTER_SLOT_PX * scale` pixels tall. */
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
      <InitialTile
        name={name}
        colour={colour}
        px={CHARACTER_SLOT_PX * scale}
        label={label}
        bob={bob}
        className={className}
        style={style}
      />
    );
  }
  const { f, rows } = spriteFit(sprites.idle.height, CHARACTER_SLOT_PX * scale);
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
