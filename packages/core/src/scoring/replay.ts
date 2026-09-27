// SPEC §4.1–4.2: replay a chore's counted completions into scores. The whole
// (chore, season) is rebuilt on every write to that chore, so the output is
// always a pure function of the rows, never of the order they arrive in or of
// what was stored before.
import { seasonYear } from "../time";
import { scoreCompletion } from "./points";
import {
  RULESET_V1,
  ruleVersionAt,
  type CompletionStatus,
  type ConfirmMode,
  type RuleVersion,
  type Ruleset,
} from "./ruleset";

export interface ReplayCompletion {
  id: string;
  doneBy: string;
  occurredAt: Date;
  loggedAt: Date;
  status: CompletionStatus;
  /** The chore's confirm mode, which decides whether `pending` counts. */
  confirmMode: ConfirmMode;
}

/** One `completion_scores` row (SPEC §5), minus `computed_at`. */
export interface CompletionScore {
  completionId: string;
  ruleVersionId: string;
  rulesetVersion: number;
  streakLen: number;
  multiplierPct: number;
  basePts: number;
  streakPts: number;
  /** The previous holder whose streak this completion broke, if any. */
  brokenMemberId: string | null;
  brokenLen: number | null;
  breakPts: number;
  totalPts: number;
}

/**
 * Counted for scoring (SPEC §4.1): confirmed, finalized, or optimistic
 * pending. Partner-mode pending, disputed and voided rows are skipped. None of
 * this depends on the time, so the counted set only changes on a write.
 */
export function isCounted(c: Pick<ReplayCompletion, "status" | "confirmMode">) {
  if (c.status === "confirmed" || c.status === "finalized") return true;
  return c.status === "pending" && c.confirmMode === "optimistic";
}

/** Replay order: `(occurred_at, logged_at, id)`. */
export function compareCompletions(
  a: Pick<ReplayCompletion, "id" | "occurredAt" | "loggedAt">,
  b: Pick<ReplayCompletion, "id" | "occurredAt" | "loggedAt">,
): number {
  return (
    a.occurredAt.getTime() - b.occurredAt.getTime() ||
    a.loggedAt.getTime() - b.loggedAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Scores for every counted completion of one chore, in replay order. A streak
 * is kept per chore and ends only when another member completes the chore or a
 * new season (Berlin calendar year) starts; time alone never ends it.
 */
export function replayChore(
  completions: readonly ReplayCompletion[],
  ruleVersions: readonly RuleVersion[],
  ruleset: Ruleset = RULESET_V1,
): CompletionScore[] {
  const counted = completions.filter(isCounted).sort(compareCompletions);
  const scores: CompletionScore[] = [];
  let holder: string | null = null;
  let len = 0;
  let season: number | null = null;

  for (const c of counted) {
    const year = seasonYear(c.occurredAt);
    if (year !== season) {
      // Streaks reset on 1 Jan, with nothing broken.
      season = year;
      holder = null;
      len = 0;
    }
    const rule = ruleVersionAt(ruleVersions, c.occurredAt);
    let brokenMemberId: string | null = null;
    let brokenLen: number | null = null;
    if (c.doneBy === holder) {
      len += 1;
    } else {
      if (holder !== null) {
        brokenMemberId = holder;
        brokenLen = len;
      }
      holder = c.doneBy;
      len = 1;
    }
    const points = scoreCompletion(
      rule.basePoints,
      len,
      brokenLen ?? 0,
      ruleset,
    );
    scores.push({
      completionId: c.id,
      ruleVersionId: rule.id,
      rulesetVersion: ruleset.version,
      streakLen: len,
      multiplierPct: points.multiplierPct,
      basePts: rule.basePoints,
      streakPts: points.streakPts,
      brokenMemberId,
      brokenLen,
      breakPts: points.breakPts,
      totalPts: points.totalPts,
    });
  }
  return scores;
}
