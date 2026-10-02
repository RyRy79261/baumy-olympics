import { describe, expect, it, vi } from "vitest";

// The redaction tests can fail (AGENTS.md: "A test that cannot fail proves
// nothing"). Here the builder runs with redaction switched off, and the same
// checks issue.test.ts and report-bug.test.ts make ("[email] is there, the
// address is not") go the other way: the address reaches the public body.
// If the builder ever stopped calling the redaction, those tests would fail
// exactly like this.

vi.mock("@baumy/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@baumy/core")>();
  return {
    ...real,
    sanitizeReportText: (text: string, max: number) => ({
      text: text.trim().slice(0, max),
      redacted: [],
    }),
  };
});

const { buildFeedbackIssue } = await import("./issue");

describe("buildFeedbackIssue with redaction switched off", () => {
  it("publishes the address the redaction tests say never leaks", () => {
    const issue = buildFeedbackIssue({
      kind: "bug",
      description: "email me at jane@example.com when fixed",
      reporterRef: "member-123",
      surface: "ui",
      route: "/u/jane@example.com",
    });
    expect(issue.body).toContain("jane@example.com");
    expect(issue.body).not.toContain("[email]");
    expect(issue.body).toContain("No personal data was recognised");
  });
});
