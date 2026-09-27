import { describe, expect, it } from "vitest";
import {
  CLAUDE_MODELS,
  COMMAND_TIER,
  rejectsForcedToolChoice,
} from "../models";

describe("model tiers", () => {
  it("pins one id per tier, and the command runs on quality", () => {
    expect(CLAUDE_MODELS).toEqual({
      fast: "claude-haiku-4-5",
      quality: "claude-sonnet-5",
      premium: "claude-opus-5-5",
    });
    expect(CLAUDE_MODELS[COMMAND_TIER]).toBe("claude-sonnet-5");
  });

  it("knows which models refuse a forced tool_choice", () => {
    expect(rejectsForcedToolChoice(CLAUDE_MODELS.premium)).toBe(true);
    expect(rejectsForcedToolChoice(CLAUDE_MODELS.quality)).toBe(false);
    expect(rejectsForcedToolChoice(CLAUDE_MODELS.fast)).toBe(false);
  });
});
