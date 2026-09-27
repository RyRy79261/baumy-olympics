import { describe, expect, it } from "vitest";
import { fail, fieldErrors } from "./result";

describe("fail", () => {
  it("builds a failure with optional extras", () => {
    expect(fail("NOT_FOUND", "Gone.")).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Gone.",
    });
    expect(fail("RATE_LIMITED", "Wait.", { retryAfterSeconds: 3 })).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "Wait.",
      retryAfterSeconds: 3,
    });
  });
});

describe("fieldErrors", () => {
  it("groups issues by their top-level field", () => {
    const result = fail("INVALID_INPUT", "Bad.", {
      issues: [
        { path: ["displayName"], message: "Enter a name." },
        { path: ["displayName"], message: "Too long." },
        { path: ["items", 2, "qty"], message: "Positive." },
        { path: [], message: "Change something." },
      ],
    });
    expect(fieldErrors(result)).toEqual({
      displayName: ["Enter a name.", "Too long."],
      items: ["Positive."],
      "": ["Change something."],
    });
  });

  it("is empty for success, nothing, or a failure without issues", () => {
    expect(fieldErrors({ ok: true, data: 1 })).toEqual({});
    expect(fieldErrors(null)).toEqual({});
    expect(fieldErrors(undefined)).toEqual({});
    expect(fieldErrors(fail("FORBIDDEN", "No."))).toEqual({});
  });
});
