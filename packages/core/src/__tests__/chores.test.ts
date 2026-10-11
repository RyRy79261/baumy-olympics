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
  const base = { cooldownMinutes: 48 * 60 };

  it("a chore never done is ready, with nothing to wait for", () => {
    expect(
      choreTiming({
        ...base,
        lastDoneAt: null,
        now: at("2026-09-27T10:00:00Z"),
      }),
    ).toEqual({ state: "ready", availableAt: null });
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
    });
  });

  it("is ready again exactly when the cooldown ends (SPEC §4.2)", () => {
    expect(
      choreTiming({
        ...base,
        lastDoneAt: at("2026-09-27T10:00:00Z"),
        now: at("2026-09-29T10:00:00Z"),
      }),
    ).toEqual({ state: "ready", availableAt: null });
  });

  it("has no due date, however long ago it was done (issue #189)", () => {
    const t = choreTiming({
      ...base,
      lastDoneAt: at("2026-01-01T00:00:00Z"),
      now: at("2026-09-29T10:00:00Z"),
    });
    expect(t.state).toBe("ready");
    expect(Object.keys(t).sort()).toEqual(["availableAt", "state"]);
  });
});
