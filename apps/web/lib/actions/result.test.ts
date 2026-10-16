import { describe, expect, it } from "vitest";
import { fail, fieldErrors, issuesAt } from "./result";

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

describe("issuesAt", () => {
  const result = fail("INVALID_INPUT", "Bad.", {
    issues: [
      { path: ["changes", 1, "points"], message: "At least 1." },
      { path: ["changes", 1, "points"], message: "Whole number." },
      { path: ["changes", 1], message: "Change something." },
      { path: ["changes", 0, "name"], message: "Give it a name." },
      { path: ["changes", 10, "name"], message: "Not row 1." },
      { path: ["changes"], message: "At least one." },
      { path: ["requestId"], message: "Needed." },
      { path: [], message: "Nothing sent." },
    ],
  });

  it("groups the issues under a path by the next step of theirs", () => {
    expect(issuesAt(result, ["changes", 1])).toEqual({
      points: ["At least 1.", "Whole number."],
      "": ["Change something."],
    });
    expect(issuesAt(result, ["changes", 0])).toEqual({
      name: ["Give it a name."],
    });
    expect(issuesAt(result, ["changes"])).toEqual({
      "0": ["Give it a name."],
      "1": ["At least 1.", "Whole number.", "Change something."],
      "10": ["Not row 1."],
      "": ["At least one."],
    });
  });

  it("is fieldErrors at the top, and empty where nothing is", () => {
    expect(issuesAt(result)).toEqual(fieldErrors(result));
    expect(issuesAt(result, [])).toEqual(fieldErrors(result));
    expect(issuesAt(result, ["changes", 2])).toEqual({});
    expect(issuesAt(result, ["changes", 1, "points", "deeper"])).toEqual({});
    expect(issuesAt({ ok: true, data: 1 }, ["changes", 1])).toEqual({});
    expect(issuesAt(null, ["changes"])).toEqual({});
    expect(issuesAt(fail("NOT_FOUND", "Gone."), ["changes"])).toEqual({});
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
