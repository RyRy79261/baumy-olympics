// SPEC §4.4: point weights follow how often each chore is actually done.
// Pure: the caller passes the completion times, the chore's weight and `now`.
//
// 1. `measureIntervals` takes the gaps between the chore's eligible
//    completions (finalized or confirmed, never disputed; the caller picks
//    them) inside the window, winsorises each gap and takes the median `I`.
// 2. `suggestWeights` turns `I` into the raw weight, and suggests a change
//    only outside the dead-band, at most ±25% of the current weight per step
//    and within [5, 60], with a matching cooldown.
// 3. `weightChangeAppliesAt` says when a scheduled change takes effect: the
//    next Monday 00:00 Berlin at least 48h ahead, and at least 28 days after
//    the chore's last applied change.
//
// There is no lapse (SPEC §12 decision 4): nothing here decays with time
// except the window itself.

import { expectedIntervalMinutes } from "../chores";
import { addBerlinDays, nextBerlinMonday } from "../time";

const MINUTE_MS = 60 * 1000;
const HOUR_MIN = 60;
const DAY_MIN = 24 * HOUR_MIN;

/** Every constant of SPEC §4.4. Tests seed their fixtures from these. */
export const FREQUENCY_V1 = {
  /** Fewer intervals than this is `insufficient_data`. */
  minIntervals: 6,
  /** The window is this many reference intervals long… */
  windowIntervals: 8,
  /** …but at least 90 days… */
  windowMinDays: 90,
  /** …and at most 365. */
  windowMaxDays: 365,
  /** A gap counts for at most this many reference intervals. */
  winsorMaxIntervals: 4,
  /** Weight per sqrt(day) at effort 100%: daily = 10, weekly ≈ 26. */
  pointsPerSqrtDay: 10,
  /** Suggest only if |raw − current| ≥ max(deadBandMinPts, deadBandPct% of current). */
  deadBandMinPts: 2,
  deadBandPct: 10,
  /** One step moves the weight at most this far from the current one. */
  maxStepPct: 25,
  /** A suggestion always lands in [minPoints, maxPoints]. */
  minPoints: 5,
  maxPoints: 60,
  /** The suggested cooldown is this share of `I`… */
  cooldownIntervalPct: 50,
  /** …clamped to [1h, 7d]. */
  cooldownMinMinutes: HOUR_MIN,
  cooldownMaxMinutes: 7 * DAY_MIN,
  /** A scheduled change applies at a Monday 00:00 Berlin at least this far ahead. */
  vetoLeadHours: 48,
  /** At most one applied change per chore in this many days. */
  changeSpacingDays: 28,
} as const;

export type FrequencyRules = typeof FREQUENCY_V1;

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/** The median of a non-empty list (the mean of the middle two when even). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("The median of nothing.");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The interval the window and the winsorising are measured against: the
 * chore's previous measured median when there is one, else the interval its
 * current weight implies (`expectedIntervalMinutes`, SPEC §4.4).
 */
export function referenceIntervalMinutes(input: {
  previousMedianMinutes: number | null;
  basePoints: number;
  effortFactorPct: number;
}): number {
  return (
    input.previousMedianMinutes ??
    expectedIntervalMinutes(input.basePoints, input.effortFactorPct)
  );
}

/** `clamp(8 × reference, 90d, 365d)`, in minutes. */
export function frequencyWindowMinutes(
  referenceMinutes: number,
  rules: FrequencyRules = FREQUENCY_V1,
): number {
  return clamp(
    rules.windowIntervals * referenceMinutes,
    rules.windowMinDays * DAY_MIN,
    rules.windowMaxDays * DAY_MIN,
  );
}

export interface MeasureInput {
  /** `occurred_at` of every eligible completion, in any order. */
  completedAt: readonly Date[];
  now: Date;
  /** From `referenceIntervalMinutes`. */
  referenceMinutes: number;
  /** The chore's cooldown now: no real gap is shorter. */
  cooldownMinutes: number;
}

export interface IntervalMeasurement {
  windowStart: Date;
  windowEnd: Date;
  /** The gaps between consecutive completions in the window, oldest first, in whole minutes. */
  rawIntervals: number[];
  /** The same gaps winsorised to `[lower, upper]`. */
  intervals: number[];
  lower: number;
  upper: number;
  /** The median of `intervals` in whole minutes; null below `minIntervals`. */
  medianMinutes: number | null;
}

/**
 * The window, the gaps inside it and their median (SPEC §4.4). Each gap is
 * winsorised to `[cooldown, 4 × reference]`, so one forgotten fortnight or a
 * double log cannot drag the median.
 */
export function measureIntervals(
  input: MeasureInput,
  rules: FrequencyRules = FREQUENCY_V1,
): IntervalMeasurement {
  const end = input.now.getTime();
  const start =
    end - frequencyWindowMinutes(input.referenceMinutes, rules) * MINUTE_MS;
  const times = input.completedAt
    .map((d) => d.getTime())
    .filter((t) => t >= start && t <= end)
    .sort((a, b) => a - b);
  const rawIntervals: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    rawIntervals.push(Math.round((times[i]! - times[i - 1]!) / MINUTE_MS));
  }
  const lower = input.cooldownMinutes;
  const upper = Math.max(
    lower,
    Math.round(rules.winsorMaxIntervals * input.referenceMinutes),
  );
  const intervals = rawIntervals.map((x) => clamp(x, lower, upper));
  return {
    windowStart: new Date(start),
    windowEnd: new Date(end),
    rawIntervals,
    intervals,
    lower,
    upper,
    medianMinutes:
      intervals.length >= rules.minIntervals
        ? Math.round(median(intervals))
        : null,
  };
}

/** `10 × effort × sqrt(I_days)`, unrounded. */
export function rawWeight(
  medianMinutes: number,
  effortFactorPct: number,
  rules: FrequencyRules = FREQUENCY_V1,
): number {
  return (
    rules.pointsPerSqrtDay *
    (effortFactorPct / 100) *
    Math.sqrt(medianMinutes / DAY_MIN)
  );
}

/** `clamp(0.5 × I, 1h, 7d)`, in whole minutes. */
export function suggestedCooldownMinutes(
  medianMinutes: number,
  rules: FrequencyRules = FREQUENCY_V1,
): number {
  return clamp(
    Math.round((medianMinutes * rules.cooldownIntervalPct) / 100),
    rules.cooldownMinMinutes,
    rules.cooldownMaxMinutes,
  );
}

export type WeightVerdict =
  | { kind: "insufficient_data"; sampleSize: number }
  | {
      /** Inside the dead-band, or the clamps land back on the current weight. */
      kind: "no_change";
      sampleSize: number;
      medianMinutes: number;
      rawPoints: number;
      cooldownMinutes: number;
    }
  | {
      kind: "suggest";
      sampleSize: number;
      medianMinutes: number;
      rawPoints: number;
      suggestedPoints: number;
      cooldownMinutes: number;
    };

/**
 * SPEC §4.4:
 *
 *     suggest only if |raw − current| ≥ max(2, 10% current)
 *     suggested = clamp(round(clamp(raw, 0.75·cur, 1.25·cur)), 5, 60)
 *     cooldown  = clamp(0.5·I, 60min, 7d)
 */
export function suggestWeights(
  input: {
    measurement: Pick<IntervalMeasurement, "intervals" | "medianMinutes">;
    currentPoints: number;
    effortFactorPct: number;
  },
  rules: FrequencyRules = FREQUENCY_V1,
): WeightVerdict {
  const sampleSize = input.measurement.intervals.length;
  const medianMinutes = input.measurement.medianMinutes;
  if (medianMinutes === null) return { kind: "insufficient_data", sampleSize };

  const current = input.currentPoints;
  const rawPoints = rawWeight(medianMinutes, input.effortFactorPct, rules);
  const cooldownMinutes = suggestedCooldownMinutes(medianMinutes, rules);
  const deadBand = Math.max(
    rules.deadBandMinPts,
    (rules.deadBandPct * current) / 100,
  );
  const step = rules.maxStepPct / 100;
  const suggestedPoints = clamp(
    Math.round(clamp(rawPoints, (1 - step) * current, (1 + step) * current)),
    rules.minPoints,
    rules.maxPoints,
  );
  if (Math.abs(rawPoints - current) < deadBand || suggestedPoints === current) {
    return {
      kind: "no_change",
      sampleSize,
      medianMinutes,
      rawPoints,
      cooldownMinutes,
    };
  }
  return {
    kind: "suggest",
    sampleSize,
    medianMinutes,
    rawPoints,
    suggestedPoints,
    cooldownMinutes,
  };
}

/**
 * When a change scheduled at `now` applies: the first Monday 00:00 Berlin at
 * least 48h ahead, pushed on to the first Monday at least 28 days after the
 * chore's last applied change (`lastAppliedAt`, itself a scheduled Monday).
 */
export function weightChangeAppliesAt(
  input: { now: Date; lastAppliedAt: Date | null },
  rules: FrequencyRules = FREQUENCY_V1,
): Date {
  // `nextBerlinMonday` is strictly after, so step back 1ms to allow "exactly".
  const lead = input.now.getTime() + rules.vetoLeadHours * 60 * MINUTE_MS;
  const soonest = nextBerlinMonday(new Date(lead - 1));
  if (input.lastAppliedAt === null) return soonest;
  const spaced = addBerlinDays(input.lastAppliedAt, rules.changeSpacingDays);
  return soonest.getTime() >= spaced.getTime()
    ? soonest
    : nextBerlinMonday(new Date(spaced.getTime() - 1));
}

/** Whether a change applying at `appliesAt` is far enough from the last one. */
export function changeSpacingOk(
  input: { appliesAt: Date; lastAppliedAt: Date | null },
  rules: FrequencyRules = FREQUENCY_V1,
): boolean {
  if (input.lastAppliedAt === null) return true;
  return (
    input.appliesAt.getTime() >=
    addBerlinDays(input.lastAppliedAt, rules.changeSpacingDays).getTime()
  );
}
