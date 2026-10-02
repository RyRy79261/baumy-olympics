import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_LIMITS,
  REPORT_DESCRIPTION_MAX,
  ReportBugInput,
} from "../feedback";

describe("ReportBugInput", () => {
  it("defaults to a bug and trims the description", () => {
    expect(ReportBugInput.parse({ description: "  it broke  " })).toEqual({
      kind: "bug",
      description: "it broke",
    });
  });

  it("refuses an empty or over-long description", () => {
    expect(ReportBugInput.safeParse({ description: "   " }).success).toBe(
      false,
    );
    expect(
      ReportBugInput.safeParse({
        description: "x".repeat(REPORT_DESCRIPTION_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("caps the diagnostics so a crafted request cannot post a wall of text", () => {
    const error = {
      at: "2026-10-02T10:00:00.000Z",
      source: "window.error",
      message: "boom",
    };
    const ok = ReportBugInput.safeParse({
      description: "x",
      diagnostics: {
        environment: [{ label: "Browser", value: "Firefox" }],
        errors: Array.from({ length: DIAGNOSTICS_LIMITS.errors }, () => error),
      },
    });
    expect(ok.success).toBe(true);
    const tooMany = ReportBugInput.safeParse({
      description: "x",
      diagnostics: {
        environment: [],
        errors: Array.from(
          { length: DIAGNOSTICS_LIMITS.errors + 1 },
          () => error,
        ),
      },
    });
    expect(tooMany.success).toBe(false);
    const tooLong = ReportBugInput.safeParse({
      description: "x",
      diagnostics: {
        environment: [],
        errors: [
          { ...error, message: "m".repeat(DIAGNOSTICS_LIMITS.message + 1) },
        ],
      },
    });
    expect(tooLong.success).toBe(false);
  });

  it("refuses fields it does not know", () => {
    expect(
      ReportBugInput.safeParse({ description: "x", email: "a@b.co" }).success,
    ).toBe(false);
  });
});
