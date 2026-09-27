// Shared fixtures for the SPEC §4.6 worked examples. The chores are the seed
// values of SPEC §4.7; everything about scoring comes from RULESET_V1.
import { berlinWallTimeToUtc } from "../../time";
import type { ConfirmMode, CompletionStatus, RuleVersion } from "../ruleset";
import type { ReplayCompletion } from "../replay";

export const RYAN = "member-ryan";
export const PARTNER = "member-partner";

const HOUR_MIN = 60;

function seedRule(chore: string, basePoints: number, cooldownHours: number) {
  return {
    id: `rule-${chore}-seed`,
    effectiveFrom: new Date(Date.UTC(2000, 0, 1)),
    basePoints,
    cooldownMinutes: cooldownHours * HOUR_MIN,
  } satisfies RuleVersion;
}

export const TRASH = seedRule("trash", 20, 48);
export const DISHES = seedRule("dishes", 10, 12);
export const BATHROOM = seedRule("bathroom", 26, 84);

/** A Berlin wall-clock time as a UTC instant. */
export function berlin(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return berlinWallTimeToUtc(year, month, day, hour, minute);
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

let seq = 0;

export function completion(
  doneBy: string,
  occurredAt: Date,
  overrides: Partial<ReplayCompletion> = {},
): ReplayCompletion {
  seq += 1;
  return {
    id: `c-${String(seq).padStart(6, "0")}`,
    doneBy,
    occurredAt,
    loggedAt: occurredAt,
    status: "confirmed" satisfies CompletionStatus,
    confirmMode: "optimistic" satisfies ConfirmMode,
    ...overrides,
  };
}

/** `doers[i]` completes the chore at `start + i × gap`. */
export function series(
  doers: readonly string[],
  start: Date,
  gapMs = 3 * DAY,
): ReplayCompletion[] {
  return doers.map((d, i) =>
    completion(d, new Date(start.getTime() + i * gapMs)),
  );
}
