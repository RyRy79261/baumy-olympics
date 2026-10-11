// A chore's timing (SPEC §3.1, §4.2; §12 decision 35, owner ruling
// 2026-10-11, issue #189): a chore has no due date. It is either ready to
// log, or cooling down until its last live completion plus its cooldown
// ("Again from <time>"). Pure; the caller passes `now`.
//
// The interval a chore's weight implies is still needed by the frequency
// maths (scoring/frequency.ts): the weight formula is
// `base = 10 × effort × sqrt(I_days)`, so `I_days = (base / (10 × effort))²`.
// The seed values of SPEC §4.7 were set from their expected intervals with
// that same formula, so this gives back those intervals (Trash 20 → 4 days,
// Dishes 10 → 1 day).

const MINUTE_MS = 60 * 1000;
const DAY_MIN = 24 * 60;

/** The interval, in minutes, that a chore's weight implies (see above). */
export function expectedIntervalMinutes(
  basePoints: number,
  effortFactorPct: number,
): number {
  const perSqrtDay = (10 * effortFactorPct) / 100;
  const days = (basePoints / perSqrtDay) ** 2;
  return Math.round(days * DAY_MIN);
}

/**
 * - `ready`: it may be logged now (never done, or its cooldown has ended);
 * - `cooldown`: done too recently to log again, until `availableAt`.
 */
export type ChoreState = "ready" | "cooldown";

export interface ChoreTiming {
  state: ChoreState;
  /** When it can be logged again; null when it already can. */
  availableAt: Date | null;
}

export function choreTiming(input: {
  /** The last live completion's `occurred_at`, or null. */
  lastDoneAt: Date | null;
  cooldownMinutes: number;
  now: Date;
}): ChoreTiming {
  if (input.lastDoneAt === null) return { state: "ready", availableAt: null };
  const available =
    input.lastDoneAt.getTime() + input.cooldownMinutes * MINUTE_MS;
  // Exactly on the boundary it may be logged (SPEC §4.2).
  return input.now.getTime() < available
    ? { state: "cooldown", availableAt: new Date(available) }
    : { state: "ready", availableAt: null };
}
