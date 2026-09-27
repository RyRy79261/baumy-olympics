import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { RequestCtx } from "@/lib/actions/define";
import type { ActionResult } from "@/lib/actions/result";
import type { ToolSpec } from "@/lib/actions/tool-specs";
import type { CreateMessage } from "@/lib/integrations/claude";
import { createMessage } from "./claude-call";
import type { Proposal, ProposalChoices } from "./proposal";

// The Baumy command's tool loop (SPEC §3.6, §6.3):
//
//   1. Claude gets the registry's `ai` tools, the system prompt and the text;
//   2. READ tool_use blocks run straight away through `runAction` (source
//      `ai`, the asker's own actor and gates) and go back as tool results;
//   3. the first reply with any WRITE tool_use ends the loop: each write
//      becomes a proposal (checked and previewed, never run), and any reads
//      in that same reply are dropped;
//   4. a reply with no tool_use is Baumy's answer.
//
// At most MAX_TURNS Claude calls, all inside one deadline. Tool results are
// the action's own `{ok, data}` or `{ok: false, code, message}`: messages are
// sentences for people, never SQL or a stack (SPEC §9).

export const MAX_TURNS = 6;
export const COMMAND_DEADLINE_MS = 50_000;
export const COMMAND_MAX_TOKENS = 4_000;
export const MAX_HISTORY = 12;

export const TOO_MANY_STEPS =
  "That took me too many steps. Try asking for one thing at a time.";
export const PROPOSED =
  "Here's what I'd do. Check it, then approve or reject it.";
export const NOTHING_TO_SAY = "Hmm, I'm not sure what to say to that.";

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CommandDeps {
  create: CreateMessage;
  model: string;
  tools: readonly ToolSpec[];
  kindOf: (name: string) => "read" | "write" | undefined;
  runAction: (
    name: string,
    input: unknown,
    ctx: RequestCtx,
  ) => Promise<ActionResult<unknown>>;
  propose: (
    name: string,
    input: unknown,
    ctx: RequestCtx,
    choices: ProposalChoices,
  ) => Promise<Proposal>;
  nowMs: () => number;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface CommandRequest {
  text: string;
  history: readonly HistoryTurn[];
  system: { persona: string; context: string };
  choices: ProposalChoices;
}

export interface CommandOutcome {
  reply: string;
  proposals: Proposal[];
}

type ToolUse = Extract<Anthropic.ContentBlock, { type: "tool_use" }>;

/** The registry's tool specs as Claude tools (no `$schema`, no `risk`). */
export function claudeTools(specs: readonly ToolSpec[]): Anthropic.Tool[] {
  return specs.map((s) => {
    const { $schema: _drop, ...schema } = s.input_schema;
    return {
      name: s.name,
      description: s.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
  });
}

function replyText(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** The tool result Claude sees for one read. */
export function toolResult(
  use: ToolUse,
  result: ActionResult<unknown>,
): Anthropic.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: use.id,
    content: JSON.stringify(result),
    ...(result.ok ? {} : { is_error: true }),
  };
}

export async function runCommand(
  req: CommandRequest,
  ctx: RequestCtx,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  const deadline = deps.nowMs() + COMMAND_DEADLINE_MS;
  const tools = claudeTools(deps.tools);
  const system: Anthropic.TextBlockParam[] = [
    // Tools then the persona never change: the cacheable prefix.
    {
      type: "text",
      text: req.system.persona,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: req.system.context },
  ];
  const messages: Anthropic.MessageParam[] = [
    ...req.history.slice(-MAX_HISTORY).map((h) => ({
      role: h.role,
      content: h.text,
    })),
    { role: "user", content: req.text },
  ];
  // A conversation starts with the user: drop a leading assistant turn.
  while (messages[0]?.role === "assistant") messages.shift();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await createMessage(
      deps.create,
      {
        model: deps.model,
        max_tokens: COMMAND_MAX_TOKENS,
        system,
        tools,
        messages,
      },
      {
        deadline,
        nowMs: deps.nowMs,
        ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
      },
    );
    const uses = message.content.filter(
      (b): b is ToolUse => b.type === "tool_use",
    );
    const said = replyText(message.content);
    if (uses.length === 0) {
      return { reply: said || NOTHING_TO_SAY, proposals: [] };
    }

    // Anything that is not a registered read is a proposal: a write, or a
    // name we do not know (shown as invalid, never run).
    const writes = uses.filter((u) => deps.kindOf(u.name) !== "read");
    if (writes.length > 0) {
      const proposals: Proposal[] = [];
      for (const w of writes) {
        proposals.push(await deps.propose(w.name, w.input, ctx, req.choices));
      }
      return { reply: said || PROPOSED, proposals };
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      results.push(
        toolResult(use, await deps.runAction(use.name, use.input, ctx)),
      );
    }
    messages.push(
      { role: "assistant", content: message.content },
      { role: "user", content: results },
    );
  }
  return { reply: TOO_MANY_STEPS, proposals: [] };
}
