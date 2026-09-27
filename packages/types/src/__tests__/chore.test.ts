import { describe, expect, it } from "vitest";
import {
  BasePoints,
  CHORE_NAME_MAX,
  COMPLETION_NOTE_MAX,
  ChoreName,
  CompletionNote,
  ConfirmMode,
  CooldownHours,
  EffortFactorPct,
  ProofMode,
  cooldownMinutesFromHours,
} from "../chore";

describe("ChoreName", () => {
  it("trims and accepts 1 to 40 characters", () => {
    expect(ChoreName.parse("  Trash ")).toBe("Trash");
    expect(ChoreName.parse("x".repeat(CHORE_NAME_MAX))).toHaveLength(40);
  });

  it("refuses blank and overlong names", () => {
    expect(ChoreName.safeParse("  ").success).toBe(false);
    expect(ChoreName.safeParse("x".repeat(CHORE_NAME_MAX + 1)).success).toBe(
      false,
    );
  });
});

describe("modes", () => {
  it("accept only the pg enum values", () => {
    expect(ProofMode.options).toEqual(["none", "optional", "required"]);
    expect(ConfirmMode.options).toEqual(["optimistic", "partner"]);
    expect(ProofMode.safeParse("always").success).toBe(false);
  });
});

describe("numbers", () => {
  it("coerce form strings and keep the db ranges", () => {
    expect(BasePoints.parse("20")).toBe(20);
    expect(BasePoints.parse(200)).toBe(200);
    for (const bad of [0, 201, 2.5, "x"]) {
      expect(BasePoints.safeParse(bad).success).toBe(false);
    }
    expect(EffortFactorPct.parse("150")).toBe(150);
    for (const bad of [49, 301, 99.5]) {
      expect(EffortFactorPct.safeParse(bad).success).toBe(false);
    }
  });

  it("takes cooldowns in hours, fractions included, and stores whole minutes", () => {
    expect(CooldownHours.parse("84")).toBe(84);
    expect(CooldownHours.parse(0)).toBe(0);
    expect(CooldownHours.safeParse(-1).success).toBe(false);
    expect(CooldownHours.safeParse(24 * 30 + 1).success).toBe(false);
    expect(cooldownMinutesFromHours(3.5 * 24)).toBe(5040);
    expect(cooldownMinutesFromHours(0.25)).toBe(15);
  });
});

describe("CompletionNote", () => {
  it("keeps notes short", () => {
    expect(CompletionNote.parse(" took ages ")).toBe("took ages");
    expect(
      CompletionNote.safeParse("x".repeat(COMPLETION_NOTE_MAX + 1)).success,
    ).toBe(false);
  });
});
