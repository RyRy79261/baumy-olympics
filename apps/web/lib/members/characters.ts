import type { Queryable } from "@baumy/db";
import { listActiveMembers } from "@baumy/db/members";
import type { AvatarSprites } from "@baumy/types";
import { avatarImageView } from "@/lib/avatars/paths";

// Every member's look and colour, from ONE place (ADR 0005 §5, issue #116):
// the gallery character they picked (issue #111), or, without one, their
// initial in their colour (`members.color`), over the ACTIVE members in join
// order. The kitchen dashboard, the avatar bar, the reminder faces, the hub's
// header, the scoreboards, Settings and the calendar chips all read it, so a
// member is the same colour everywhere.

/** How one member is shown: MemberCharacter's `sprites`, `name`, `colour`. */
export interface MemberLook {
  name: string;
  /** `members.color` (`#rrggbb`): their colour on every screen. */
  colour: string;
  /** Their gallery set, or null: then their initial tile. */
  sprites: AvatarSprites | null;
}

/** Each member's colour (`members.color`), by id. */
export function rosterColours(
  people: readonly { id: string; color: string }[],
): Record<string, string> {
  return Object.fromEntries(people.map((p) => [p.id, p.color]));
}

/** The active members' looks, by id, in join order. */
export async function activeRoster(
  db: Queryable,
  householdId: string,
): Promise<Map<string, MemberLook>> {
  return rosterFrom(await listActiveMembers(db, householdId));
}

/** These members' looks, by id, in their order. */
export function rosterFrom(
  people: readonly {
    id: string;
    displayName: string;
    color: string;
    avatarImage: Parameters<typeof avatarImageView>[0];
  }[],
): Map<string, MemberLook> {
  return new Map(
    people.map((p) => [
      p.id,
      {
        name: p.displayName,
        colour: p.color,
        sprites: avatarImageView(p.avatarImage),
      },
    ]),
  );
}
