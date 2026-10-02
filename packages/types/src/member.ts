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

/**
 * What each of MEMBER_COLORS is called: the swatch pickers' accessible
 * names, so a screen reader says "Orange", never "#e8743b".
 */
export const MEMBER_COLOR_NAMES: Readonly<
  Record<(typeof MEMBER_COLORS)[number], string>
> = {
  "#e8743b": "Orange",
  "#3b82c4": "Blue",
  "#4caf50": "Green",
  "#9c5fc9": "Purple",
  "#d9b300": "Mustard",
  "#d0467a": "Rose",
};

/** A member colour's name; one not in MEMBER_COLORS is a "Custom colour". */
export function memberColorName(color: string): string {
  const key = color.toLowerCase() as (typeof MEMBER_COLORS)[number];
  return MEMBER_COLOR_NAMES[key] ?? "Custom colour";
}

/** How many digits a kiosk PIN has (SPEC §6.2), at least and at most. */
export const KIOSK_PIN_MIN_DIGITS = 4;
export const KIOSK_PIN_MAX_DIGITS = 6;

/** A kiosk PIN (SPEC §6.2): 4 to 6 digits. */
export const KioskPin = z
  .string()
  .regex(
    new RegExp(`^\\d{${KIOSK_PIN_MIN_DIGITS},${KIOSK_PIN_MAX_DIGITS}}$`),
    `Use ${KIOSK_PIN_MIN_DIGITS} to ${KIOSK_PIN_MAX_DIGITS} digits.`,
  );

/** What a wrong Telegram user id is told, by the server and the browser. */
export const TELEGRAM_ID_MESSAGE =
  "Use the Telegram user id: digits only, not starting with 0.";

/**
 * A Telegram user id (`members.telegram_user_id`): a positive integer of at
 * most 52 bits, so a JS number holds it exactly. Takes the digits as a
 * string too, as a form field or the `X-Baumy-Actor` header sends them.
 */
export const TelegramUserId = z
  .union(
    [
      z.int(),
      z
        .string()
        .trim()
        .regex(/^[1-9]\d{0,15}$/, TELEGRAM_ID_MESSAGE)
        .transform(Number),
    ],
    { error: TELEGRAM_ID_MESSAGE },
  )
  .pipe(
    z
      .int()
      .positive(TELEGRAM_ID_MESSAGE)
      .max(Number.MAX_SAFE_INTEGER, TELEGRAM_ID_MESSAGE),
  );

/**
 * A Telegram link code as someone types it after `/link` (SPEC §6.6): the
 * 10 characters /settings shows, in any case. Anything that could not be a
 * code is refused before it is hashed.
 */
export const TelegramLinkCode = z
  .string()
  .trim()
  .min(8, "That code is too short. Copy it from Settings.")
  .max(32, "That code is too long. Copy it from Settings.")
  .regex(/^[A-Za-z0-9]+$/, "A link code is letters and digits only.");
