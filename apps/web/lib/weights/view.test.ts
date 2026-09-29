import { describe, expect, it } from "vitest";
import { berlinWallTimeToUtc } from "@baumy/core";
import {
  appliesLabel,
  changeLabel,
  formatMinutes,
  formatRaw,
  historyByLabel,
  historyChangeLabel,
  historyOutcomeLabel,
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
    expect(intervalsLabel([6 * DAY_MIN, 12 * 60])).toBe(
      "Gaps between completions: 6 days, 12 h.",
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

  it("puts a points history entry into words (issue #115)", () => {
    const iso = (d: number, h = 0) =>
      berlinWallTimeToUtc(2026, 10, d, h).toISOString();
    const ryan = { memberId: "m-1", displayName: "Ryan" };
    const partner = { memberId: "m-2", displayName: "Partner" };
    const entry = {
      source: "admin" as const,
      proposedBy: ryan,
      proposedAt: iso(1, 9),
      fromPoints: 35,
      fromCooldownMinutes: 84 * 60,
      toPoints: 50,
      toCooldownMinutes: 2 * DAY_MIN,
      appliesAt: iso(5),
      outcome: "pending" as const,
      decidedBy: null,
      decidedAt: null,
    };
    expect(historyChangeLabel(entry)).toBe(
      "35 → 50 pts, cooldown 3.5 days → 2 days",
    );
    expect(
      historyChangeLabel({
        ...entry,
        fromPoints: null,
        fromCooldownMinutes: null,
      }),
    ).toBe("50 pts, cooldown 2 days");
    expect(historyByLabel(entry)).toBe(
      "Set by an admin · Ryan, Thu 1 Oct, 09:00",
    );
    expect(historyByLabel({ ...entry, source: "seed", proposedBy: null })).toBe(
      "Starting points · Thu 1 Oct, 09:00",
    );
    // A bounty's first points, set on the admin page, start it too.
    expect(
      historyByLabel({
        ...entry,
        source: "manual",
        fromPoints: null,
        fromCooldownMinutes: null,
      }),
    ).toBe("Starting points · Ryan, Thu 1 Oct, 09:00");
    expect(historyByLabel({ ...entry, source: "manual" })).toBe(
      "Set at once · Ryan, Thu 1 Oct, 09:00",
    );
    expect(historyByLabel({ ...entry, source: "measured" })).toBe(
      "Baumy's weekly suggestion · Ryan, Thu 1 Oct, 09:00",
    );
    expect(historyOutcomeLabel(entry)).toBe(
      "Waiting: applies Mon 5 Oct, 00:00 (Berlin time) unless someone vetoes it.",
    );
    expect(historyOutcomeLabel({ ...entry, outcome: "landed" })).toBe(
      "In effect from Mon 5 Oct, 00:00.",
    );
    expect(
      historyOutcomeLabel({
        ...entry,
        outcome: "vetoed",
        decidedBy: partner,
        decidedAt: iso(2, 18),
      }),
    ).toBe("Vetoed by Partner, Fri 2 Oct, 18:00. It never applied.");
    expect(
      historyOutcomeLabel({
        ...entry,
        outcome: "cancelled",
        decidedBy: ryan,
        decidedAt: iso(3, 8),
      }),
    ).toBe("Cancelled by Ryan, Sat 3 Oct, 08:00. It never applied.");
    expect(
      historyOutcomeLabel({
        ...entry,
        outcome: "cancelled",
        decidedAt: iso(3, 8),
      }),
    ).toBe("Cancelled, Sat 3 Oct, 08:00. It never applied.");
  });
});
