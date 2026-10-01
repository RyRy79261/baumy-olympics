import { MemberCharacter } from "@baumy/ui";
import type { MemberLook } from "@/lib/members/characters";

// A member's name on the scoreboard with their character (issue #111), or
// their initial tile without one (issue #116): the leader holds their emote
// pose (when their set has one), everyone else stands idle. Used by the
// hub's and the kitchen screen's standings.

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
  roster: ReadonlyMap<string, MemberLook>;
  scale?: number;
}) {
  const look = roster.get(memberId);
  return (
    <span className="inline-flex items-center gap-2">
      <MemberCharacter
        sprites={look?.sprites}
        name={name}
        colour={look?.colour}
        scale={scale}
        pose={leader ? "emote" : "idle"}
      />
      <span>{name}</span>
    </span>
  );
}
