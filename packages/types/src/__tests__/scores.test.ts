import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_POINTS_MAX,
  ADJUSTMENT_REASON_MAX,
  AdjustmentPoints,
  AdjustmentReason,
  POT_NOTE_MAX,
  PotAmountCents,
  PotMonth,
  PotNote,
  PrizeMode,
  potMonthDate,
} from "../scores";

describe("PrizeMode", () => {
  it("has the pg enum's values and nothing else", () => {
    expect(PrizeMode.options).toEqual([
      "points",
      "heaviest_streak",
      "longest_streak",
    ]);
    expect(PrizeMode.safeParse("coin_flip").success).toBe(false);
  });
});

describe("AdjustmentPoints", () => {
  it("takes whole numbers either side of zero, from a form's strings", () => {
    expect(AdjustmentPoints.parse("-15")).toBe(-15);
    expect(AdjustmentPoints.parse(ADJUSTMENT_POINTS_MAX)).toBe(
      ADJUSTMENT_POINTS_MAX,
    );
  });

  it("refuses zero, fractions, junk and the far ends", () => {
    for (const bad of [
      "0",
      0,
      "1.5",
      "abc",
      ADJUSTMENT_POINTS_MAX + 1,
      -ADJUSTMENT_POINTS_MAX - 1,
    ]) {
      expect(AdjustmentPoints.safeParse(bad).success).toBe(false);
    }
  });
});

describe("AdjustmentReason", () => {
  it("trims and needs 1 to 200 characters", () => {
    expect(AdjustmentReason.parse("  Bins ")).toBe("Bins");
    expect(AdjustmentReason.safeParse(" ").success).toBe(false);
    expect(
      AdjustmentReason.safeParse("x".repeat(ADJUSTMENT_REASON_MAX + 1)).success,
    ).toBe(false);
  });
});

describe("PotMonth", () => {
  it("takes YYYY-MM and nothing else", () => {
    expect(PotMonth.parse("2026-09")).toBe("2026-09");
    for (const bad of ["2026-13", "2026-00", "2026-9", "2026-09-01", 202609]) {
      expect(PotMonth.safeParse(bad).success).toBe(false);
    }
    expect(potMonthDate("2026-09")).toBe("2026-09-01");
  });
});

describe("PotAmountCents", () => {
  it("reads euros as whole cents, with a dot or a comma", () => {
    expect(PotAmountCents.parse("25")).toBe(2500);
    expect(PotAmountCents.parse("25.5")).toBe(2550);
    expect(PotAmountCents.parse("25,05")).toBe(2505);
    expect(PotAmountCents.parse(" 0.01 ")).toBe(1);
    expect(PotAmountCents.parse(40)).toBe(4000);
  });

  it("refuses zero, negatives, more than two decimals, junk and huge sums", () => {
    for (const bad of [
      "0",
      "0.00",
      "-5",
      "1.234",
      "abc",
      "",
      "10000.01",
      true,
    ]) {
      expect(PotAmountCents.safeParse(bad).success).toBe(false);
    }
    expect(PotAmountCents.parse("10000")).toBe(1_000_000);
  });
});

describe("PotNote", () => {
  it("trims and caps the note", () => {
    expect(PotNote.parse(" Sept ")).toBe("Sept");
    expect(PotNote.safeParse("x".repeat(POT_NOTE_MAX + 1)).success).toBe(false);
  });
});
