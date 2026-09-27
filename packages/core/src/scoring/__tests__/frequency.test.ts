import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { expectedIntervalMinutes } from "../../chores";
import { addBerlinDays, berlinParts } from "../../time";
import {
  FREQUENCY_V1,
  changeSpacingOk,
  frequencyWindowMinutes,
  measureIntervals,
  median,
  rawWeight,
  referenceIntervalMinutes,
  suggestWeights,
  suggestedCooldownMinutes,
  weightChangeAppliesAt,
} from "../frequency";
import { BATHROOM, DAY, HOUR, TRASH, berlin } from "./fixtures";

// SPEC §4.4 and the worked examples E7 and E8 (§4.6). Every constant comes
// from FREQUENCY_V1 or the seed fixtures, not from copied numbers.

const MIN = 60_000;
const DAY_MIN = 24 * 60;
const R = FREQUENCY_V1;

/** Completions `gapsDays` apart, the last one a day before `now`. */
function completionsFromGaps(gapsDays: readonly number[], now: Date): Date[] {
  const total = gapsDays.reduce((a, b) => a + b, 0);
  let t = now.getTime() - DAY - total * DAY;
  const out = [new Date(t)];
  for (const g of gapsDays) {
    t += g * DAY;
    out.push(new Date(t));
  }
  return out;
}

/** Measure and suggest for a chore, the way packages/db does. */
function run(input: {
  gapsDays: readonly number[];
  currentPoints: number;
  cooldownMinutes: number;
  effortFactorPct?: number;
  previousMedianMinutes?: number | null;
  now?: Date;
}) {
  const now = input.now ?? berlin(2026, 9, 28, 2);
  const effortFactorPct = input.effortFactorPct ?? 100;
  const measurement = measureIntervals({
    completedAt: completionsFromGaps(input.gapsDays, now),
    now,
    referenceMinutes: referenceIntervalMinutes({
      previousMedianMinutes: input.previousMedianMinutes ?? null,
      basePoints: input.currentPoints,
      effortFactorPct,
    }),
    cooldownMinutes: input.cooldownMinutes,
  });
  const verdict = suggestWeights({
    measurement,
    currentPoints: input.currentPoints,
    effortFactorPct,
  });
  return { measurement, verdict };
}

describe("worked examples", () => {
  it("E7: Bathroom at 35 with a 7-day median suggests 26 and a 3.5-day cooldown", () => {
    const { measurement, verdict } = run({
      gapsDays: [6, 7, 7, 8, 5, 9, 7, 14, 6, 7, 7, 8],
      currentPoints: 35,
      cooldownMinutes: BATHROOM.cooldownMinutes,
    });
    expect(measurement.intervals).toHaveLength(12);
    // Nothing was winsorised: 14 days is under 4 × the reference.
    expect(measurement.intervals).toEqual(measurement.rawIntervals);
    expect(measurement.medianMinutes).toBe(7 * DAY_MIN);
    expect(verdict).toEqual({
      kind: "suggest",
      sampleSize: 12,
      medianMinutes: 7 * DAY_MIN,
      rawPoints: 10 * Math.sqrt(7),
      suggestedPoints: 26,
      cooldownMinutes: 3.5 * DAY_MIN,
    });
    expect(verdict.kind === "suggest" && verdict.rawPoints).toBeCloseTo(
      26.46,
      2,
    );
  });

  it("E8: Trash at 15 with I = 4 days is clamped to 18.75 and suggests 19", () => {
    const gapsDays = Array(R.minIntervals + 2).fill(4);
    const first = run({
      gapsDays,
      currentPoints: 15,
      cooldownMinutes: TRASH.cooldownMinutes,
    });
    expect(first.verdict).toMatchObject({
      kind: "suggest",
      rawPoints: 20,
      suggestedPoints: 19,
      cooldownMinutes: 2 * DAY_MIN,
    });
    // 1.25 × 15 = 18.75, which rounds to 19.
    expect((1 + R.maxStepPct / 100) * 15).toBe(18.75);

    // The next cycle: 19 against a raw 20 is inside the dead-band.
    const next = run({
      gapsDays,
      currentPoints: 19,
      cooldownMinutes: TRASH.cooldownMinutes,
      previousMedianMinutes: first.measurement.medianMinutes,
    });
    expect(next.verdict).toEqual({
      kind: "no_change",
      sampleSize: gapsDays.length,
      medianMinutes: 4 * DAY_MIN,
      rawPoints: 20,
      cooldownMinutes: 2 * DAY_MIN,
    });
  });
});

describe("measureIntervals", () => {
  it("needs at least 6 intervals: 5 is insufficient_data", () => {
    const five = run({
      gapsDays: Array(R.minIntervals - 1).fill(4),
      currentPoints: 15,
      cooldownMinutes: TRASH.cooldownMinutes,
    });
    expect(five.measurement.intervals).toHaveLength(5);
    expect(five.measurement.medianMinutes).toBeNull();
    expect(five.verdict).toEqual({ kind: "insufficient_data", sampleSize: 5 });

    const six = run({
      gapsDays: Array(R.minIntervals).fill(4),
      currentPoints: 15,
      cooldownMinutes: TRASH.cooldownMinutes,
    });
    expect(six.verdict.kind).toBe("suggest");
  });

  it("with no completions at all, there are no intervals", () => {
    const now = berlin(2026, 9, 28);
    const m = measureIntervals({
      completedAt: [],
      now,
      referenceMinutes: DAY_MIN,
      cooldownMinutes: 0,
    });
    expect(m.intervals).toEqual([]);
    expect(m.medianMinutes).toBeNull();
    expect(m.windowEnd).toEqual(now);
  });

  it("only counts completions inside the window, and none after now", () => {
    const now = berlin(2026, 9, 28, 12);
    const reference = DAY_MIN; // → the 90-day floor
    const windowStart = now.getTime() - R.windowMinDays * DAY;
    const m = measureIntervals({
      completedAt: [
        new Date(windowStart - 1), // just outside
        new Date(windowStart),
        new Date(windowStart + DAY),
        new Date(now.getTime() + MIN), // logged "in the future"
      ],
      now,
      referenceMinutes: reference,
      cooldownMinutes: 0,
    });
    expect(m.windowStart).toEqual(new Date(windowStart));
    expect(m.rawIntervals).toEqual([DAY_MIN]);
  });

  it("winsorises each gap to [cooldown, 4 × reference]", () => {
    const now = berlin(2026, 9, 28, 12);
    const start = now.getTime() - 60 * DAY;
    const offsetsHours = [0, 1, 25, 49, 73, 97, 121, 121 + 30 * 24];
    const m = measureIntervals({
      completedAt: offsetsHours.map((h) => new Date(start + h * HOUR)),
      now,
      referenceMinutes: DAY_MIN,
      cooldownMinutes: 12 * 60,
    });
    expect(m.lower).toBe(12 * 60);
    expect(m.upper).toBe(R.winsorMaxIntervals * DAY_MIN);
    expect(m.rawIntervals).toEqual([
      60,
      ...Array(5).fill(DAY_MIN),
      30 * DAY_MIN,
    ]);
    expect(m.intervals).toEqual([
      12 * 60,
      ...Array(5).fill(DAY_MIN),
      4 * DAY_MIN,
    ]);
    expect(m.medianMinutes).toBe(DAY_MIN);
  });

  it("never lets the upper bound fall below the cooldown", () => {
    const now = berlin(2026, 9, 28, 12);
    const m = measureIntervals({
      completedAt: completionsFromGaps(Array(6).fill(3), now),
      now,
      referenceMinutes: 60,
      cooldownMinutes: 2 * DAY_MIN,
    });
    expect(m.upper).toBe(2 * DAY_MIN);
    expect(m.intervals).toEqual(Array(6).fill(2 * DAY_MIN));
  });

  it("does not care what order the completions come in", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 200 * DAY_MIN }), {
          maxLength: 40,
        }),
        fc.integer({ min: 60, max: 60 * DAY_MIN }),
        (offsets, reference) => {
          const now = berlin(2026, 9, 28);
          const dates = offsets.map((o) => new Date(now.getTime() - o * MIN));
          const a = measureIntervals({
            completedAt: dates,
            now,
            referenceMinutes: reference,
            cooldownMinutes: 0,
          });
          const b = measureIntervals({
            completedAt: [...dates].reverse(),
            now,
            referenceMinutes: reference,
            cooldownMinutes: 0,
          });
          expect(b).toEqual(a);
        },
      ),
    );
  });

  it("keeps every gap and the median inside the bounds", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 400 * DAY_MIN }), {
          maxLength: 60,
        }),
        fc.integer({ min: 1, max: 90 * DAY_MIN }),
        fc.integer({ min: 0, max: 7 * DAY_MIN }),
        (offsets, reference, cooldown) => {
          const now = berlin(2026, 9, 28);
          const m = measureIntervals({
            completedAt: offsets.map((o) => new Date(now.getTime() - o * MIN)),
            now,
            referenceMinutes: reference,
            cooldownMinutes: cooldown,
          });
          const windowMin = frequencyWindowMinutes(reference);
          expect(windowMin).toBeGreaterThanOrEqual(R.windowMinDays * DAY_MIN);
          expect(windowMin).toBeLessThanOrEqual(R.windowMaxDays * DAY_MIN);
          expect(m.intervals).toHaveLength(m.rawIntervals.length);
          for (const x of m.intervals) {
            expect(x).toBeGreaterThanOrEqual(m.lower);
            expect(x).toBeLessThanOrEqual(m.upper);
          }
          if (m.intervals.length < R.minIntervals) {
            expect(m.medianMinutes).toBeNull();
          } else {
            expect(m.medianMinutes).toBeGreaterThanOrEqual(
              Math.min(...m.intervals),
            );
            expect(m.medianMinutes).toBeLessThanOrEqual(
              Math.max(...m.intervals),
            );
          }
        },
      ),
    );
  });
});

describe("the window", () => {
  it("is 8 reference intervals, within [90d, 365d]", () => {
    expect(frequencyWindowMinutes(DAY_MIN)).toBe(90 * DAY_MIN);
    expect(frequencyWindowMinutes(14 * DAY_MIN)).toBe(112 * DAY_MIN);
    expect(frequencyWindowMinutes(60 * DAY_MIN)).toBe(365 * DAY_MIN);
  });

  it("is measured against the previous median, else the weight's interval", () => {
    expect(
      referenceIntervalMinutes({
        previousMedianMinutes: 5 * DAY_MIN,
        basePoints: 20,
        effortFactorPct: 100,
      }),
    ).toBe(5 * DAY_MIN);
    expect(
      referenceIntervalMinutes({
        previousMedianMinutes: null,
        basePoints: TRASH.basePoints,
        effortFactorPct: 100,
      }),
    ).toBe(expectedIntervalMinutes(TRASH.basePoints, 100));
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow("nothing");
  });
});

describe("suggestWeights", () => {
  const measured = (medianMinutes: number | null, n = 8) => ({
    intervals: Array(n).fill(medianMinutes ?? 0),
    medianMinutes,
  });

  it("scales the raw weight with effort", () => {
    expect(rawWeight(DAY_MIN, 100)).toBe(10);
    expect(rawWeight(4 * DAY_MIN, 150)).toBe(30);
  });

  it("clamps the cooldown to [1h, 7d]", () => {
    expect(suggestedCooldownMinutes(60)).toBe(R.cooldownMinMinutes);
    expect(suggestedCooldownMinutes(30 * DAY_MIN)).toBe(R.cooldownMaxMinutes);
    expect(suggestedCooldownMinutes(DAY_MIN)).toBe(12 * 60);
  });

  it("stays put at the dead-band's 2-point floor, and moves at 2", () => {
    // raw 10 (daily) against 12: exactly 2 apart, so it moves.
    expect(
      suggestWeights({
        measurement: measured(DAY_MIN),
        currentPoints: 12,
        effortFactorPct: 100,
      }),
    ).toMatchObject({ kind: "suggest", suggestedPoints: 10 });
    expect(
      suggestWeights({
        measurement: measured(DAY_MIN),
        currentPoints: 11,
        effortFactorPct: 100,
      }).kind,
    ).toBe("no_change");
  });

  it("uses 10% of the current weight as the dead-band above 20 points", () => {
    // raw 40 (16 days) against 44: 4 is under 10% of 44.
    expect(
      suggestWeights({
        measurement: measured(16 * DAY_MIN),
        currentPoints: 44,
        effortFactorPct: 100,
      }).kind,
    ).toBe("no_change");
    expect(
      suggestWeights({
        measurement: measured(16 * DAY_MIN),
        currentPoints: 45,
        effortFactorPct: 100,
      }),
    ).toMatchObject({ kind: "suggest", suggestedPoints: 40 });
  });

  it("never suggests outside [5, 60]", () => {
    // Monthly at 60 wants more, but 60 is the ceiling: no change.
    expect(
      suggestWeights({
        measurement: measured(60 * DAY_MIN),
        currentPoints: 60,
        effortFactorPct: 100,
      }).kind,
    ).toBe("no_change");
    // A manual 3 points for a daily chore goes up to the floor of 5.
    expect(
      suggestWeights({
        measurement: measured(DAY_MIN),
        currentPoints: 3,
        effortFactorPct: 100,
      }),
    ).toMatchObject({ kind: "suggest", suggestedPoints: R.minPoints });
    // 200 points for a daily chore drops 25% to 150, then to the ceiling.
    expect(
      suggestWeights({
        measurement: measured(DAY_MIN),
        currentPoints: 200,
        effortFactorPct: 100,
      }),
    ).toMatchObject({ kind: "suggest", suggestedPoints: R.maxPoints });
  });

  it("holds its rules for any measurement and weight", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 * DAY_MIN }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 50, max: 300 }),
        (medianMinutes, current, effort) => {
          const v = suggestWeights({
            measurement: measured(medianMinutes),
            currentPoints: current,
            effortFactorPct: effort,
          });
          expect(v.kind).not.toBe("insufficient_data");
          if (v.kind === "insufficient_data") return;
          expect(v.rawPoints).toBeCloseTo(
            10 * (effort / 100) * Math.sqrt(medianMinutes / DAY_MIN),
            9,
          );
          expect(v.cooldownMinutes).toBeGreaterThanOrEqual(60);
          expect(v.cooldownMinutes).toBeLessThanOrEqual(7 * DAY_MIN);
          const deadBand = Math.max(2, current / 10);
          if (v.kind === "suggest") {
            expect(Math.abs(v.rawPoints - current)).toBeGreaterThanOrEqual(
              deadBand,
            );
            expect(v.suggestedPoints).not.toBe(current);
            expect(v.suggestedPoints).toBeGreaterThanOrEqual(R.minPoints);
            expect(v.suggestedPoints).toBeLessThanOrEqual(R.maxPoints);
            // Within ±25% (after rounding), unless a bound pulled it out.
            if (
              v.suggestedPoints !== R.minPoints &&
              v.suggestedPoints !== R.maxPoints
            ) {
              expect(Math.abs(v.suggestedPoints - current)).toBeLessThanOrEqual(
                current * 0.25 + 0.5,
              );
              // …and towards raw. (A manual weight above 60 is pulled down
              // to the ceiling whatever raw says, per the formula.)
              expect(Math.sign(v.suggestedPoints - current)).toBe(
                Math.sign(v.rawPoints - current),
              );
            }
          }
        },
      ),
    );
  });
});

describe("weightChangeAppliesAt", () => {
  it("is the next Monday 00:00 Berlin at least 48h ahead", () => {
    // Monday 10:00 → the Monday after (7 days on).
    expect(
      weightChangeAppliesAt({
        now: berlin(2026, 9, 28, 10),
        lastAppliedAt: null,
      }),
    ).toEqual(berlin(2026, 10, 5));
    // Saturday 00:00 is exactly 48h before Monday 00:00: that Monday.
    expect(
      weightChangeAppliesAt({ now: berlin(2026, 10, 3), lastAppliedAt: null }),
    ).toEqual(berlin(2026, 10, 5));
    // A minute later is too late for it.
    expect(
      weightChangeAppliesAt({
        now: berlin(2026, 10, 3, 0, 1),
        lastAppliedAt: null,
      }),
    ).toEqual(berlin(2026, 10, 12));
  });

  it("waits 28 days after the last applied change", () => {
    const last = berlin(2026, 9, 21);
    // Scheduled on Tue 22 Sep: the 48h rule alone says 28 Sep.
    expect(
      weightChangeAppliesAt({
        now: berlin(2026, 9, 22, 9),
        lastAppliedAt: last,
      }),
    ).toEqual(berlin(2026, 10, 19));
    // Across the October change, still Monday 00:00 four weeks on.
    const oct = berlin(2026, 10, 12);
    expect(
      weightChangeAppliesAt({
        now: berlin(2026, 10, 12, 9),
        lastAppliedAt: oct,
      }),
    ).toEqual(berlin(2026, 11, 9));
    expect(
      changeSpacingOk({ appliesAt: berlin(2026, 11, 9), lastAppliedAt: oct }),
    ).toBe(true);
    expect(
      changeSpacingOk({ appliesAt: berlin(2026, 11, 2), lastAppliedAt: oct }),
    ).toBe(false);
    expect(
      changeSpacingOk({ appliesAt: berlin(2026, 11, 2), lastAppliedAt: null }),
    ).toBe(true);
  });

  it("is always a Monday midnight, 48h ahead and 28 days after the last", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2020-01-01T00:00:00Z"),
          max: new Date("2040-01-01T00:00:00Z"),
          noInvalidDate: true,
        }),
        fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
        (now, lastDaysAgo) => {
          const lastAppliedAt =
            lastDaysAgo === null
              ? null
              : weightChangeAppliesAt({
                  now: new Date(now.getTime() - (lastDaysAgo + 2) * DAY),
                  lastAppliedAt: null,
                });
          const at = weightChangeAppliesAt({ now, lastAppliedAt });
          const p = berlinParts(at);
          expect(p.weekday).toBe(1);
          expect([p.hour, p.minute, p.second]).toEqual([0, 0, 0]);
          expect(at.getTime() - now.getTime()).toBeGreaterThanOrEqual(
            R.vetoLeadHours * HOUR,
          );
          expect(changeSpacingOk({ appliesAt: at, lastAppliedAt })).toBe(true);
          if (lastAppliedAt) {
            // Not a week later than it has to be.
            const earliest = addBerlinDays(lastAppliedAt, R.changeSpacingDays);
            const lead = now.getTime() + R.vetoLeadHours * HOUR;
            expect(at.getTime()).toBeLessThan(
              Math.max(earliest.getTime(), lead) + 7 * DAY + HOUR,
            );
          }
        },
      ),
    );
  });
});
