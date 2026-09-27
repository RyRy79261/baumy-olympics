// When a chore is due (SPEC §3.1, §4.4): the chore grid and the hub show
// which chores are due from the natural interval, and which are still
// cooling down. Pure; the caller passes `now`.
//
// The natural interval is the median gap SPEC §4.4 measures from real
// completions (issue #17). Until that exists, it is read back out of the
// chore's weight: the weight formula is `base = 10 × effort × sqrt(I_days)`,
// so `I_days = (base / (10 × effort))²`. The seed values of SPEC §4.7 were
// set from their expected intervals with that same formula, so this gives
// back those intervals (Trash 20 → 4 days, Dishes 10 → 1 day).

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
 * - `cooldown`: done too recently to log again (until `availableAt`);
 * - `due`: never done, or the interval since the last time has passed;
 * - `done`: loggable, but not due until `dueAt`.
 */
export type ChoreDueState = "due" | "cooldown" | "done";

export interface ChoreTiming {
  state: ChoreDueState;
  /** When it can be logged again; null when it already can. */
  availableAt: Date | null;
  /** When it falls due; null when it has never been done. */
  dueAt: Date | null;
}

export function choreTiming(input: {
  /** The last live completion's `occurred_at`, or null. */
  lastDoneAt: Date | null;
  cooldownMinutes: number;
  intervalMinutes: number;
  now: Date;
}): ChoreTiming {
  if (input.lastDoneAt === null) {
    return { state: "due", availableAt: null, dueAt: null };
  }
  const last = input.lastDoneAt.getTime();
  const available = last + input.cooldownMinutes * MINUTE_MS;
  // A chore is never due before it may be logged.
  const due =
    last + Math.max(input.intervalMinutes, input.cooldownMinutes) * MINUTE_MS;
  const now = input.now.getTime();
  if (now < available) {
    return {
      state: "cooldown",
      availableAt: new Date(available),
      dueAt: new Date(due),
    };
  }
  return {
    state: now >= due ? "due" : "done",
    availableAt: null,
    dueAt: new Date(due),
  };
}
