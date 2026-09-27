import { z } from "zod";

// What a household member looks like at every boundary (SPEC §5 `members`):
// the join form, the admin members page, `update_my_profile` and the actions
// behind them all parse with these, so a name the join form accepts is a name
// the admin page accepts too.

export const DISPLAY_NAME_MAX = 40;

/** The name housemates see: trimmed, 1 to 40 characters. */
export const DisplayName = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(DISPLAY_NAME_MAX, `Keep it to ${DISPLAY_NAME_MAX} characters.`);

/** A member's colour on the scoreboard, stored as lowercase `#rrggbb`. */
export const MemberColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #ff8800.")
  .transform((c) => c.toLowerCase());

/**
 * The avatar sprites a member can pick. Placeholder names until the pixel UI
 * kit (issue #7) draws them; the ids are what `members.avatar_sprite` stores,
 * so the art can change without a data migration.
 */
export const AVATAR_SPRITES = [
  "cat",
  "fox",
  "owl",
  "frog",
  "bear",
  "bunny",
] as const;

export const AvatarSprite = z.enum(AVATAR_SPRITES, {
  error: "Pick one of the avatars.",
});
export type AvatarSprite = z.infer<typeof AvatarSprite>;

/** The same values as the `member_role` pg enum. */
export const MemberRole = z.enum(["admin", "member"], {
  error: "Pick admin or member.",
});
export type MemberRole = z.infer<typeof MemberRole>;

/**
 * The colours offered to a new member, in order. The join form and the admin
 * page offer these; any `#rrggbb` is still valid.
 */
export const MEMBER_COLORS = [
  "#e8743b",
  "#3b82c4",
  "#4caf50",
  "#9c5fc9",
  "#d9b300",
  "#d0467a",
] as const;

/** A kiosk PIN (SPEC §6.2): 4 to 6 digits. */
export const KioskPin = z.string().regex(/^\d{4,6}$/, "Use 4 to 6 digits.");
