import { z } from "zod";

// The avatar gallery (issue #111): pre-generated pixel characters the owner
// uploads and every member picks from.

export const AVATAR_NAME_MAX = 40;

/** What a gallery sprite is called ("Knight", "Ryan in shades"). */
export const AvatarName = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(AVATAR_NAME_MAX, `Keep it to ${AVATAR_NAME_MAX} characters.`);

export const AvatarId = z.uuid("Pick a character from the gallery.");

/** `add_avatar`: the name; the image comes from the upload route. */
export const NewAvatar = z.strictObject({
  name: AvatarName.describe("What the character is called."),
});

/** `archive_avatar`, `restore_avatar`. */
export const AvatarRef = z.strictObject({
  avatarId: AvatarId.describe("The gallery character's id."),
});

/** A form's empty choice means "none"; anything else must be an id. */
const OptionalAvatarId = z.preprocess(
  (v) => (v === "" ? null : v),
  AvatarId.nullable(),
);

/** `choose_avatar`: a gallery character, or null for the drawn one. */
export const ChooseAvatar = z.strictObject({
  avatarId: OptionalAvatarId.describe(
    "The gallery character to wear, or null to go back to the drawn one.",
  ),
});

/** The optional pick on /join (`redeem_invite`, `join_as_founder`). */
export const JoinAvatarId = OptionalAvatarId.optional();

/**
 * A gallery sprite as a screen draws it: its URL (always the /api/blob
 * proxy) and its own size in pixels, so it is scaled by whole numbers.
 */
export interface AvatarImage {
  src: string;
  width: number;
  height: number;
}

/** A character's poses (owner ruling 2026-09-29), in sheet order. */
export const AVATAR_POSES = ["idle", "walk", "emote"] as const;
export type AvatarPose = (typeof AVATAR_POSES)[number];

/** How tall a set is cleaned to, in its own pixels; the admin picks. */
export const AVATAR_HEIGHTS = [48, 56, 64] as const;
export const DEFAULT_AVATAR_HEIGHT = 64;

/** `preview_avatar`: the height to clean the set to. */
export const PreviewAvatar = z.strictObject({
  height: z.coerce
    .number()
    .refine((h) => (AVATAR_HEIGHTS as readonly number[]).includes(h), {
      message: "Pick 48, 56 or 64 pixels tall.",
    })
    .default(DEFAULT_AVATAR_HEIGHT)
    .describe("The height to clean the character to, in its own pixels."),
});

/**
 * A gallery character as a screen draws it: idle always; walk and emote
 * when the set has them.
 */
export interface AvatarSprites {
  idle: AvatarImage;
  walk?: AvatarImage | null;
  emote?: AvatarImage | null;
}
