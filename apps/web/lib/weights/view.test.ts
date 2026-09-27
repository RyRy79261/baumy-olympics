import { describe, expect, it } from "vitest";
import { berlinWallTimeToUtc } from "@baumy/core";
import {
  appliesLabel,
  changeLabel,
  formatMinutes,
  formatRaw,
  hoursField,
  intervalsLabel,
  verdictLabel,
} from "./view";

const DAY_MIN = 24 * 60;

describe("weights view", () => {
  it("says a length of time in days, hours or minutes", () => {
    expect(formatMinutes(7 * DAY_MIN)).toBe("7 days");
    expect(formatMinutes(3.5 * DAY_MIN)).toBe("3.5 days");
    expect(formatMinutes(DAY_MIN)).toBe("1 day");
    expect(formatMinutes(12 * 60)).toBe("12 h");
    expect(formatMinutes(90)).toBe("1.5 h");
    expect(formatMinutes(45)).toBe("45 min");
  });

  it("gives minutes as hours for a form", () => {
    expect(hoursField(5040)).toBe("84");
    expect(hoursField(90)).toBe("1.5");
    expect(hoursField(100)).toBe("1.67");
  });

  it("shows the raw weight to two decimals", () => {
    expect(formatRaw(10 * Math.sqrt(7))).toBe("26.46");
    expect(formatRaw(null)).toBe("–");
  });

  it("says what the measurement means", () => {
    const live = {
      sampleSize: 5,
      intervals: [],
      medianMinutes: null,
      rawPoints: null,
      suggestedPoints: null,
      suggestedCooldownMinutes: null,
      verdict: "insufficient_data" as const,
    };
    expect(verdictLabel(null)).toBe("No points set yet.");
    expect(verdictLabel(live)).toBe("Not enough data yet: 5 of 6 gaps.");
    expect(verdictLabel({ ...live, verdict: "no_change" })).toBe(
      "The points fit how often it is done.",
    );
    expect(
      verdictLabel({ ...live, verdict: "suggest", suggestedPoints: 26 }),
    ).toBe("The formula says 26 pts.");
  });

  it("puts the gaps into words for screen readers", () => {
    expect(intervalsLabel([])).toBe("No gaps measured yet.");
    expect(intervalsLabel([6 * DAY_MIN, 3.5 * DAY_MIN])).toBe(
      "Gaps between completions, in days: 6, 3.5.",
    );
  });

  it("says when a change applies and what it changes", () => {
    expect(appliesLabel(berlinWallTimeToUtc(2026, 10, 5).toISOString())).toBe(
      "Applies Mon 5 Oct, 00:00 (Berlin time) unless someone vetoes it.",
    );
    expect(
      changeLabel({
        fromPoints: 35,
        toPoints: 26,
        fromCooldownMinutes: 84 * 60,
        toCooldownMinutes: 3.5 * DAY_MIN,
      }),
    ).toBe("35 → 26 pts, cooldown 3.5 days → 3.5 days");
  });
});
