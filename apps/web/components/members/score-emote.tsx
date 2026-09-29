"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { MemberCharacter } from "@baumy/ui";
import { onScore } from "@/lib/ui/scored";

// The acting member's character, which emotes once each time this screen
// scores points (issue #111, lib/ui/scored.ts). Remounting it with a new
// key replays the 2-second emote; until the first score it plays whatever
// `moment` it was given (the kiosk's walk-in), or none.

export function ScoreEmote(props: ComponentProps<typeof MemberCharacter>) {
  const [scores, setScores] = useState(0);
  useEffect(() => onScore(() => setScores((n) => n + 1)), []);
  return (
    <MemberCharacter
      key={scores}
      {...props}
      moment={scores > 0 ? "emote" : props.moment}
    />
  );
}
