// What the next completion of a chore would score (SPEC §4.2), for the
// preview a person approves before logging ("+25, streak 2"). It is exactly
// one more step of `replayChore`: a new completion is always the latest one
// (the validator refuses anything before the last live completion), so the
// replay of the season with it appended scores it like this. A test holds the
// two together.
import { scoreCompletion, type CompletionPoints } from "./points";
import { RULESET_V1, type Ruleset } from "./ruleset";

/** Who holds a chore's streak this season, and how long it is. */
export interface StreakState {
  holderId: string;
  length: number;
}

export interface NextScore extends CompletionPoints {
  streakLen: number;
  /** The holder whose streak this completion would break, if any. */
  brokenMemberId: string | null;
  brokenLen: number | null;
}

/**
 * The score of `doneBy` completing a chore whose base is `basePoints`, given
 * the chore's current streak this season (null when nobody holds one, which
 * includes a new season).
 */
export function nextScore(
  basePoints: number,
  streak: StreakState | null,
  doneBy: string,
  ruleset: Ruleset = RULESET_V1,
): NextScore {
  const again = streak !== null && streak.holderId === doneBy;
  const streakLen = again ? streak.length + 1 : 1;
  const broken = !again && streak !== null ? streak : null;
  const points = scoreCompletion(
    basePoints,
    streakLen,
    broken?.length ?? 0,
    ruleset,
  );
  return {
    ...points,
    streakLen,
    brokenMemberId: broken?.holderId ?? null,
    brokenLen: broken?.length ?? null,
  };
}
