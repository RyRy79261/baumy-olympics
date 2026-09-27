import { describe, expect, it } from "vitest";
import {
  PRIZE_MODES,
  breakdownLabel,
  disputeLabel,
  formatEuros,
  gapLabel,
  prizeModeLabel,
  signedPoints,
} from "./view";

describe("formatEuros", () => {
  it("prints cents as euros with two decimals and thousands separators", () => {
    expect(formatEuros(8050)).toBe("€80.50");
    expect(formatEuros(5)).toBe("€0.05");
    expect(formatEuros(0)).toBe("€0.00");
    expect(formatEuros(123456789)).toBe("€1,234,567.89");
    expect(formatEuros(-250)).toBe("-€2.50");
  });
});

describe("labels", () => {
  it("signs adjustment points", () => {
    expect(signedPoints(15)).toBe("+15");
    expect(signedPoints(-7)).toBe("-7");
  });

  it("names the prize modes, and only points is playable", () => {
    expect(prizeModeLabel("points")).toBe("Points: winner takes the whole pot");
    expect(prizeModeLabel("longest_streak")).toMatch(/coming later/);
    expect(PRIZE_MODES.filter((m) => m.playable).map((m) => m.mode)).toEqual([
      "points",
    ]);
  });

  it("says how far behind the leader someone is", () => {
    expect(gapLabel(0)).toBe("Leader");
    expect(gapLabel(170)).toBe("170 behind");
  });

  it("counts disputes, or says none", () => {
    expect(disputeLabel(undefined)).toBe("None");
    expect(disputeLabel({ raised: 0, against: 0 })).toBe("None");
    expect(disputeLabel({ raised: 1, against: 2 })).toBe(
      "1 raised · 2 against",
    );
  });

  it("breaks a completion's points down", () => {
    const plain = {
      basePts: 20,
      streakBonusPts: 0,
      streakLen: 1,
      breakPts: 0,
      brokenMemberName: null,
      brokenLen: null,
    };
    expect(breakdownLabel(plain)).toBe("20 base");
    expect(breakdownLabel({ ...plain, streakBonusPts: 5, streakLen: 2 })).toBe(
      "20 base + 5 streak (2 in a row)",
    );
    expect(
      breakdownLabel({
        ...plain,
        breakPts: 8,
        brokenMemberName: "Ryan",
        brokenLen: 2,
      }),
    ).toBe("20 base + 8 break (Ryan's 2)");
    expect(breakdownLabel({ ...plain, breakPts: 4, brokenLen: 1 })).toBe(
      "20 base + 4 break (someone's 1)",
    );
  });
});
