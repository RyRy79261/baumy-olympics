import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { breakPoints, multiplierPct, pctOf, scoreCompletion } from "../points";
import { RULESET_V1 } from "../ruleset";
import { DISHES, TRASH } from "./fixtures";

const base = fc.integer({ min: 1, max: 200 });
const streak = fc.integer({ min: 1, max: 500 });
const broken = fc.integer({ min: 0, max: 500 });

describe("multiplierPct", () => {
  it("starts at 100% and adds the streak step per completion", () => {
    expect(multiplierPct(1)).toBe(100);
    expect(multiplierPct(2)).toBe(100 + RULESET_V1.streakStepPct);
    expect(multiplierPct(5)).toBe(200);
  });

  it("is 100 + 25·(n−1) and strictly increasing, with no cap", () => {
    fc.assert(
      fc.property(streak, (n) => {
        expect(multiplierPct(n)).toBe(100 + 25 * (n - 1));
        expect(multiplierPct(n + 1)).toBeGreaterThan(multiplierPct(n));
      }),
    );
    expect(multiplierPct(1000)).toBe(100 + 25 * 999);
  });
});

describe("pctOf", () => {
  it("rounds half up to an integer", () => {
    expect(pctOf(DISHES.basePoints, 125)).toBe(13); // 12.5 → 13 (E4)
    expect(pctOf(10, 124)).toBe(12); // 12.4 → 12
    expect(pctOf(20, 100)).toBe(20);
  });
});

describe("breakPoints", () => {
  it("pays nothing when nothing was broken", () => {
    expect(breakPoints(TRASH.basePoints, 0)).toBe(0);
  });

  it("pays 20% of base per broken length, capped at 10", () => {
    expect(breakPoints(20, 1)).toBe(4);
    expect(breakPoints(20, 10)).toBe(40);
    expect(breakPoints(20, 11)).toBe(40);
  });

  it("is monotone in the broken length and flat from the cap on", () => {
    fc.assert(
      fc.property(base, broken, (b, len) => {
        expect(breakPoints(b, len + 1)).toBeGreaterThanOrEqual(
          breakPoints(b, len),
        );
        if (len >= RULESET_V1.breakLenCap) {
          expect(breakPoints(b, len)).toBe(
            breakPoints(b, RULESET_V1.breakLenCap),
          );
        }
      }),
    );
  });
});

describe("scoreCompletion", () => {
  it("adds the streak points and the break bonus", () => {
    expect(scoreCompletion(DISHES.basePoints, 1, 3)).toEqual({
      multiplierPct: 100,
      streakPts: 10,
      breakPts: 6,
      totalPts: 16,
    });
  });

  it("always gives an integer total of at least the base", () => {
    fc.assert(
      fc.property(base, streak, broken, (b, n, len) => {
        const s = scoreCompletion(b, n, len);
        expect(Number.isInteger(s.totalPts)).toBe(true);
        expect(Number.isInteger(s.streakPts)).toBe(true);
        expect(Number.isInteger(s.breakPts)).toBe(true);
        expect(s.totalPts).toBeGreaterThanOrEqual(b);
        expect(s.totalPts).toBe(s.streakPts + s.breakPts);
      }),
    );
  });
});
