// Pinned Claude model tiers (SPEC §6.3), ported from intake-tracker
// `packages/ai-prompts/src/models.ts`. SDK-free `as const` literals, so pure
// code and the route handlers name the same ids without pulling the
// Anthropic SDK into their graph.
//
// Which tier a route uses is a deliberate choice:
//   - fast (Haiku 4.5): cheap tidying jobs: the bug reporter's "Improve
//     with AI" pass (feedback.ts, issue #133).
//   - quality (Sonnet 5): the Baumy command (`/api/ai/command`). It picks
//     tools and answers household questions: short turns, where latency and
//     the per-command price matter more than the last bit of reasoning.
//   - premium (Opus 5.5): nothing yet.

export const CLAUDE_MODELS = {
  // Claude Haiku 4.5. Accepts sampling parameters, forced tool_choice and
  // `budget_tokens` thinking, but NOT `output_config.effort` (a 400).
  fast: "claude-haiku-4-5" as const,
  // Claude Sonnet 5:
  //   - `temperature`/`top_p`/`top_k` return a 400 unless left at the
  //     default, so the command sets none of them;
  //   - adaptive thinking is ON when `thinking` is omitted, and its tokens
  //     count against `max_tokens`, so budgets need headroom for it;
  //   - forced tool_choice is still accepted.
  quality: "claude-sonnet-5" as const,
  // Claude Opus 5.5: forced `tool_choice` returns a 400, thinking cannot be
  // disabled, and effort defaults to `medium`.
  premium: "claude-opus-5-5" as const,
} as const;

export type ClaudeTier = keyof typeof CLAUDE_MODELS;
export type ClaudeModelId = (typeof CLAUDE_MODELS)[ClaudeTier];

/** The tier the Baumy command runs on. */
export const COMMAND_TIER: ClaudeTier = "quality";

/**
 * Models that reject a forced `tool_choice` with a 400. Shared code checks
 * this before forcing a tool, so a tier bump onto such a model degrades to
 * `auto` instead of failing.
 */
const REJECTS_FORCED_TOOL_CHOICE: ReadonlySet<string> = new Set([
  "claude-opus-5-5",
  "claude-fable-5-1",
  "claude-mythos-5-1",
]);

export function rejectsForcedToolChoice(model: string): boolean {
  return REJECTS_FORCED_TOOL_CHOICE.has(model);
}
