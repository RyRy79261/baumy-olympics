import type { Queryable } from "@baumy/db";
import { listActiveMembers } from "@baumy/db/members";
import { rosterAvatars, type MemberAvatar } from "@baumy/types";
import { SHIRT_COLOURS } from "@baumy/ui";

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
  return rosterAvatars(await listActiveMembers(db, householdId));
}
