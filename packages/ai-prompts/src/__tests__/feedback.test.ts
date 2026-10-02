import { describe, expect, it } from "vitest";
import {
  REPORT_FORMAT_TOOL,
  REPORT_SYSTEM_PROMPT,
  REPORT_TIER,
  reportUserMessage,
} from "../feedback";
import { CLAUDE_MODELS, rejectsForcedToolChoice } from "../models";

describe("the bug reporter's AI pass", () => {
  it("runs on the fast tier, which accepts the forced format tool", () => {
    expect(REPORT_TIER).toBe("fast");
    expect(rejectsForcedToolChoice(CLAUDE_MODELS[REPORT_TIER])).toBe(false);
  });

  it("never asks the model for a severity or priority", () => {
    const asked = JSON.stringify(REPORT_FORMAT_TOOL) + REPORT_SYSTEM_PROMPT;
    expect(asked).toContain("format_report");
    expect(asked).not.toMatch(/severity|priority/i);
  });

  it("puts the report between quotes, after its kind", () => {
    const message = reportUserMessage("bug", "the log button does nothing");
    expect(message).toContain("Report type: bug");
    expect(message).toContain('"""\nthe log button does nothing\n"""');
  });
});
