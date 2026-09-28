import { avatarFor, type MemberAvatar } from "@baumy/types";
import type { CSSProperties } from "react";
import { cx } from "./cx";
import { PixelArt } from "./pixel/pixel-art";
import type { Palette, Sprite } from "./pixel/pixel-grid";

// A member's 16-bit character (ADR 0005 §5): a 12 × 17 person from the
// approved prototype (proto/kiosk-home-pixel, pixels.tsx), built from a
// head for the hair style, a neck and a body, and coloured from the
// member's `members.avatar` choices. Nobody has to choose: without one the
// member gets `defaultAvatar(id)`. The ids live in packages/types; what
// each id looks like lives here, so the art can change without a migration.

const BODY: Sprite = [
  "..KSSSSSSK..",
  ".KSSSSSSSSK.",
  "KsKSSddSSKsK",
  "KsKSSSSSSKsK",
  ".KKppppppKK.",
  "..KppKKppK..",
  "..KooK.KooK.",
];

const NECK = "...KKssKK...";

/** One head per hair style (the prototype's four housemates). */
export const HAIR_STYLE_HEADS: Readonly<
  Record<MemberAvatar["hairStyle"], Sprite>
> = {
  short: [
    "............",
    "...KKKKKK...",
    "..KhhhhhhK..",
    ".KhhhhhhhhK.",
    ".KhsshhsshK.",
    ".KssssssssK.",
    ".KsKssssKsK.",
    ".KssssssssK.",
    "..KssmmssK..",
  ],
  long: [
    "...KKKKKK...",
    "..KhhhhhhK..",
    ".KhhhhhhhhK.",
    "KhhhhhhhhhhK",
    "hKhsssssshKh",
    "hKssssssssKh",
    "hKsKssssKsKh",
    "hKssssssssKh",
    "hhKssmmssKhh",
  ],
  spiky: [
    ".K.K.KK.K.K.",
    "KhKhKhhKhKhK",
    ".KhhhhhhhhK.",
    ".KhhhhhhhhK.",
    ".KssssssssK.",
    ".KssssssssK.",
    ".KsKssssKsK.",
    ".KssssssssK.",
    "..KssmmssK..",
  ],
  bob: [
    "...KKKKKK...",
    "..KhhhhhhK..",
    ".KhhhhhhhhK.",
    "KhhhhhhhhhhK",
    "KhhhhhhhhhhK",
    "KhKssssssKhK",
    "KhKsKssKsKhK",
    "KhKssssssKhK",
    ".KKssmmssKK.",
  ],
};

/** Hair colours; black is lifted to a violet-black so it reads on the dark UI. */
export const HAIR_COLOURS: Readonly<Record<MemberAvatar["hairColor"], string>> =
  {
    brown: "#3b2a1a",
    auburn: "#c2410c",
    black: "#2a2238",
    platinum: "#e5e7eb",
    blonde: "#e3b754",
  };

export const SKIN_TONES: Readonly<Record<MemberAvatar["skinTone"], string>> = {
  pale: "#f7d8bd",
  light: "#f2c29b",
  tan: "#d39a6a",
  brown: "#a8704a",
  deep: "#6e4630",
};

/** The shirts are the UI's accent colours (app/globals.css `--color-bm-*`). */
export const SHIRT_COLOURS: Readonly<
  Record<MemberAvatar["shirtColor"], string>
> = {
  teal: "#4ff5e6",
  pink: "#ff8fc7",
  yellow: "#ffe46b",
  violet: "#8f7dff",
  amber: "#ffb347",
  green: "#43f0a0",
};

/** The character's grid: head, neck, body. */
export function housemateGrid(hairStyle: MemberAvatar["hairStyle"]): Sprite {
  return [...HAIR_STYLE_HEADS[hairStyle], NECK, ...BODY];
}

/** The palette one character is drawn in. */
export function housematePalette(avatar: MemberAvatar): Palette {
  return {
    K: "#0b0712", // outline
    h: HAIR_COLOURS[avatar.hairColor],
    s: SKIN_TONES[avatar.skinTone],
    m: "#c2416b", // mouth
    S: SHIRT_COLOURS[avatar.shirtColor],
    d: "#0b0712", // the shirt's print
    p: "#3a2c5c", // trousers
    o: "#1a1226", // shoes
  };
}

export function Housemate({
  avatar,
  memberId = "",
  scale = 3,
  label,
  bob = false,
  className,
  style,
}: {
  /** What `members.avatar` holds; null or unknown ids fall back to the default. */
  avatar?: unknown;
  /** The member's id: picks their default character. */
  memberId?: string;
  scale?: number;
  /** Accessible name, e.g. the member's name; without it it is decorative. */
  label?: string;
  /** Bob gently (the reminder's "not seen yet"); motion-safe only. */
  bob?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const a = avatarFor({ id: memberId, avatar: avatar ?? null });
  return (
    <span
      data-housemate
      data-hair={a.hairStyle}
      className={cx(
        "inline-block shrink-0",
        bob && "motion-safe:animate-pixel-bob",
        className,
      )}
      style={style}
    >
      <PixelArt
        grid={housemateGrid(a.hairStyle)}
        palette={housematePalette(a)}
        scale={scale}
        label={label}
        className="block"
      />
    </span>
  );
}
