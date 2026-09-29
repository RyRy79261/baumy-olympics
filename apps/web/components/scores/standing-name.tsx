import type { AvatarSprites, MemberAvatar } from "@baumy/types";
import { MemberCharacter } from "@baumy/ui";

// A member's name on the scoreboard with their character (issue #111): the
// leader holds their emote pose (when their set has one), everyone else
// stands idle. Used by the hub's and the kitchen screen's standings.

export function StandingName({
  memberId,
  name,
  leader,
  roster,
  scale = 2,
}: {
  memberId: string;
  name: string;
  leader: boolean;
  /** `activeRoster` (lib/members/characters.ts). */
  roster: {
    characters: ReadonlyMap<string, MemberAvatar>;
    sprites: ReadonlyMap<string, AvatarSprites>;
  };
  scale?: number;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <MemberCharacter
        sprites={roster.sprites.get(memberId)}
        avatar={roster.characters.get(memberId)}
        memberId={memberId}
        scale={scale}
        pose={leader ? "emote" : "idle"}
      />
      <span>{name}</span>
    </span>
  );
}
