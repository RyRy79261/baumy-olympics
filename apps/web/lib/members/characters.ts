import type { Queryable } from "@baumy/db";
import { listActiveMembers } from "@baumy/db/members";
import {
  rosterAvatars,
  type AvatarSprites,
  type MemberAvatar,
} from "@baumy/types";
import { SHIRT_COLOURS } from "@baumy/ui";
import { avatarImageView } from "@/lib/avatars/paths";

// Every member's character and colour, from ONE place (ADR 0005 §5): the
// character they chose, or the roster's default (packages/types
// `rosterAvatars`: a shirt nobody else wears, earlier joiners first), over
// the ACTIVE members in join order. The kitchen dashboard, the avatar bar,
// the reminder faces, the hub's header, Settings and the calendar chips all
// read it, so a member is the same colour everywhere.

/** Each member's shirt colour (`#rrggbb`): their colour on every screen. */
export function rosterColours(
  roster: ReadonlyMap<string, MemberAvatar>,
): Record<string, string> {
  return Object.fromEntries(
    [...roster].map(([id, a]) => [id, SHIRT_COLOURS[a.shirtColor]]),
  );
}

/** The active members' characters, by id. */
export async function activeCharacters(
  db: Queryable,
  householdId: string,
): Promise<Map<string, MemberAvatar>> {
  return (await activeRoster(db, householdId)).characters;
}

/**
 * The active members' characters and, for those who picked one, their
 * gallery sprite (issue #111), which is drawn instead. Their colour is
 * still the character's shirt.
 */
export async function activeRoster(
  db: Queryable,
  householdId: string,
): Promise<{
  characters: Map<string, MemberAvatar>;
  sprites: Map<string, AvatarSprites>;
}> {
  const people = await listActiveMembers(db, householdId);
  const sprites = new Map<string, AvatarSprites>();
  for (const p of people) {
    const image = avatarImageView(p.avatarImage);
    if (image) sprites.set(p.id, image);
  }
  return { characters: rosterAvatars(people), sprites };
}
