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

/**
 * A member's 16-bit character (ADR 0005 §5), stored in `members.avatar` as
 * the ids below. The art (issue #7's kit) decides what each id looks like,
 * so the palette can change without a data migration.
 */
export const AVATAR_HAIR_STYLES = ["short", "long", "spiky", "bob"] as const;
export const AVATAR_HAIR_COLORS = [
  "brown",
  "auburn",
  "black",
  "platinum",
  "blonde",
] as const;
export const AVATAR_SKIN_TONES = [
  "pale",
  "light",
  "tan",
  "brown",
  "deep",
] as const;
export const AVATAR_SHIRT_COLORS = [
  "teal",
  "pink",
  "yellow",
  "violet",
  "amber",
  "green",
] as const;

export const AvatarHairStyle = z.enum(AVATAR_HAIR_STYLES, {
  error: "Pick one of the hair styles.",
});
export const AvatarHairColor = z.enum(AVATAR_HAIR_COLORS, {
  error: "Pick one of the hair colours.",
});
export const AvatarSkinTone = z.enum(AVATAR_SKIN_TONES, {
  error: "Pick one of the skin tones.",
});
export const AvatarShirtColor = z.enum(AVATAR_SHIRT_COLORS, {
  error: "Pick one of the shirt colours.",
});

/** A whole character: what `update_avatar` takes and `members.avatar` holds. */
export const MemberAvatar = z.strictObject({
  hairStyle: AvatarHairStyle.describe("The hair style."),
  hairColor: AvatarHairColor.describe("The hair colour."),
  skinTone: AvatarSkinTone.describe("The skin tone."),
  shirtColor: AvatarShirtColor.describe("The shirt colour."),
});
export type MemberAvatar = z.infer<typeof MemberAvatar>;

/** A small, stable hash of a string (FNV-1a), for picking defaults. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function pick<T>(options: readonly T[], seed: number): T {
  return options[seed % options.length]!;
}

/**
 * The character a member has until they choose one: picked from their id,
 * so it never changes and housemates usually differ. Nobody has to choose.
 */
export function defaultAvatar(memberId: string): MemberAvatar {
  const h = fnv1a(memberId);
  return {
    hairStyle: pick(AVATAR_HAIR_STYLES, h),
    hairColor: pick(AVATAR_HAIR_COLORS, h >>> 4),
    skinTone: pick(AVATAR_SKIN_TONES, h >>> 8),
    shirtColor: pick(AVATAR_SHIRT_COLORS, h >>> 12),
  };
}

/**
 * The character to draw for a member: what they chose, or the default when
 * `members.avatar` is null or holds an id the art no longer has.
 */
export function avatarFor(member: {
  id: string;
  avatar: unknown;
}): MemberAvatar {
  const chosen = MemberAvatar.safeParse(member.avatar);
  return chosen.success ? chosen.data : defaultAvatar(member.id);
}

/**
 * Every active member's character, the roster given in join order. A shirt
 * is a member's colour on the kitchen screen, so members who have not
 * chosen one get a shirt nobody else wears: their id's default if it is
 * free, else the next free one in AVATAR_SHIRT_COLORS order, the earlier
 * joiner first. Chosen characters are kept as they are (two members may
 * choose the same shirt). Once every shirt is taken, the default stands.
 */
export function rosterAvatars(
  roster: readonly { id: string; avatar: unknown }[],
): Map<string, MemberAvatar> {
  const out = new Map<string, MemberAvatar>();
  const worn = new Set<MemberAvatar["shirtColor"]>();
  for (const m of roster) {
    const chosen = MemberAvatar.safeParse(m.avatar);
    if (chosen.success) {
      out.set(m.id, chosen.data);
      worn.add(chosen.data.shirtColor);
    }
  }
  for (const m of roster) {
    if (out.has(m.id)) continue;
    const base = defaultAvatar(m.id);
    const start = AVATAR_SHIRT_COLORS.indexOf(base.shirtColor);
    let shirt = base.shirtColor;
    for (let i = 0; i < AVATAR_SHIRT_COLORS.length; i++) {
      const next =
        AVATAR_SHIRT_COLORS[(start + i) % AVATAR_SHIRT_COLORS.length]!;
      if (!worn.has(next)) {
        shirt = next;
        break;
      }
    }
    worn.add(shirt);
    out.set(m.id, { ...base, shirtColor: shirt });
  }
  return out;
}

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

const TELEGRAM_ID_MESSAGE = "Use the Telegram user id: digits only.";

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
