import { describe, expect, it } from "vitest";
import { choreTiming, expectedIntervalMinutes } from "../chores";

const DAY_MIN = 24 * 60;
const at = (s: string) => new Date(s);

describe("expectedIntervalMinutes", () => {
  it.each([
    // SPEC §4.7: base ≈ 10·sqrt(I_days) at effort 100%.
    [20, 100, 4],
    [10, 100, 1],
    [26, 100, 6.76],
    [55, 100, 30.25],
  ])("base %i at effort %i%% is %f days", (base, effort, days) => {
    expect(expectedIntervalMinutes(base, effort)).toBe(
      Math.round(days * DAY_MIN),
    );
  });

  it("a harder chore (more effort) is expected more often for the same base", () => {
    // 20 points at 200% effort: 10·2·sqrt(I) = 20 → I = 1 day.
    expect(expectedIntervalMinutes(20, 200)).toBe(DAY_MIN);
  });
});

describe("choreTiming", () => {
  const base = {
    cooldownMinutes: 48 * 60,
    intervalMinutes: 4 * DAY_MIN,
  };

  it("a chore never done is due, with nothing to wait for", () => {
    expect(
      choreTiming({
        ...base,
        lastDoneAt: null,
        now: at("2026-09-27T10:00:00Z"),
      }),
    ).toEqual({ state: "due", availableAt: null, dueAt: null });
  });

  it("is cooling down until the cooldown ends", () => {
    expect(
      choreTiming({
        ...base,
        lastDoneAt: at("2026-09-27T10:00:00Z"),
        now: at("2026-09-28T10:00:00Z"),
      }),
    ).toEqual({
      state: "cooldown",
      availableAt: at("2026-09-29T10:00:00Z"),
      dueAt: at("2026-10-01T10:00:00Z"),
    });
  });

  it("is loggable but not due between the cooldown and the interval", () => {
    // Exactly on the cooldown boundary it may be logged (SPEC §4.2).
    expect(
      choreTiming({
        ...base,
        lastDoneAt: at("2026-09-27T10:00:00Z"),
        now: at("2026-09-29T10:00:00Z"),
      }),
    ).toEqual({
      state: "done",
      availableAt: null,
      dueAt: at("2026-10-01T10:00:00Z"),
    });
  });

  it("is due once the interval has passed", () => {
    expect(
      choreTiming({
        ...base,
        lastDoneAt: at("2026-09-27T10:00:00Z"),
        now: at("2026-10-01T10:00:00Z"),
      }).state,
    ).toBe("due");
  });

  it("is never due before it may be logged", () => {
    const t = choreTiming({
      cooldownMinutes: 7 * DAY_MIN,
      intervalMinutes: DAY_MIN,
      lastDoneAt: at("2026-09-01T00:00:00Z"),
      now: at("2026-09-03T00:00:00Z"),
    });
    expect(t).toEqual({
      state: "cooldown",
      availableAt: at("2026-09-08T00:00:00Z"),
      dueAt: at("2026-09-08T00:00:00Z"),
    });
  });
});
