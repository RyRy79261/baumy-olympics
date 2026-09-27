// SPEC §4.2. Every scoring constant lives here, and tests seed their fixtures
// from these values rather than from copied numbers (AGENTS.md).

export const RULESET_V1 = {
  version: 1,
  /** +25% per consecutive completion by the holder. No cap (SPEC §12.11). */
  streakStepPct: 25,
  /** The break bonus is 20% of base per broken length… */
  breakPctPerLen: 20,
  /** …counted up to 10, so it tops out at 200% of base. */
  breakLenCap: 10,
  /** Breaking a 1-streak already pays (SPEC §12.2). */
  minBrokenStreak: 1,
  undoWindowMin: 10,
  challengeWindowH: 24,
  partnerConfirmExpiryH: 72,
  /** A completion may be logged at most 24h after it happened. */
  maxBackdateH: 24,
  /** …and at most 2 minutes "in the future", for clock skew. */
  maxFutureMin: 2,
} as const;

export type Ruleset = typeof RULESET_V1;

/** The statuses a completion row can hold (SPEC §4.3). */
export type CompletionStatus =
  "pending" | "confirmed" | "finalized" | "disputed" | "voided";

/** A chore's confirmation mode (SPEC §4.3). */
export type ConfirmMode = "optimistic" | "partner";

/** A row of `chore_rule_versions`: the chore's weight from `effectiveFrom` on. */
export interface RuleVersion {
  id: string;
  effectiveFrom: Date;
  basePoints: number;
  cooldownMinutes: number;
}

export class NoRuleVersionError extends Error {
  constructor(at: Date) {
    super(`No chore rule version is in effect at ${at.toISOString()}.`);
    this.name = "NoRuleVersionError";
  }
}

/**
 * The rule version in effect at `at`: the one with the latest `effectiveFrom`
 * that is not after `at`. Changes are never retroactive, so a completion is
 * always scored and cooled down by the version in effect when it happened.
 */
export function ruleVersionAt(
  versions: readonly RuleVersion[],
  at: Date,
): RuleVersion {
  let found: RuleVersion | undefined;
  for (const v of versions) {
    if (v.effectiveFrom.getTime() > at.getTime()) continue;
    if (!found || v.effectiveFrom.getTime() > found.effectiveFrom.getTime()) {
      found = v;
    }
  }
  if (!found) throw new NoRuleVersionError(at);
  return found;
}
