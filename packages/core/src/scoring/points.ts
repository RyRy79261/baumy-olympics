// SPEC §4.2: the points for one completion. Integers only.
import { RULESET_V1, type Ruleset } from "./ruleset";

/** The streak multiplier for the n-th consecutive completion (n ≥ 1). No cap. */
export function multiplierPct(
  n: number,
  ruleset: Ruleset = RULESET_V1,
): number {
  return 100 + ruleset.streakStepPct * (n - 1);
}

/** `pct` percent of `base`, rounded half up, as an integer. */
export function pctOf(base: number, pct: number): number {
  return Math.floor((base * pct + 50) / 100);
}

/** The break bonus for breaking a streak of `brokenLen` (0 means no break). */
export function breakPoints(
  base: number,
  brokenLen: number,
  ruleset: Ruleset = RULESET_V1,
): number {
  if (brokenLen < ruleset.minBrokenStreak) return 0;
  const len = Math.min(brokenLen, ruleset.breakLenCap);
  return pctOf(base, ruleset.breakPctPerLen * len);
}

export interface CompletionPoints {
  multiplierPct: number;
  streakPts: number;
  breakPts: number;
  totalPts: number;
}

/**
 * Score one completion: the `streakLen`-th in a row by its doer, which broke
 * someone else's streak of `brokenLen` (0 when nothing was broken).
 */
export function scoreCompletion(
  base: number,
  streakLen: number,
  brokenLen: number,
  ruleset: Ruleset = RULESET_V1,
): CompletionPoints {
  const pct = multiplierPct(streakLen, ruleset);
  const streakPts = pctOf(base, pct);
  const breakPts = breakPoints(base, brokenLen, ruleset);
  return {
    multiplierPct: pct,
    streakPts,
    breakPts,
    totalPts: streakPts + breakPts,
  };
}
