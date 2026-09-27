import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParams } from "./claude";

// The E2E fake Claude (SPEC §10): a small scripted model for
// E2E_TEST_MODE=1. It gets the SAME request the real client sends (the
// registry's tools, the system prompt, the conversation with its tool
// results) and answers with real Messages API shapes, so the tool loop, the
// read tools, the proposals and the review sheet all run for real. It
// understands three things:
//
//   - "who's winning?" (win, lead, standings, score): reads get_standings,
//     then answers with the leader;
//   - "confirm …": reads get_pending_confirmations, then proposes
//     confirm_completion for the first claim the asker may confirm;
//   - "I did/took/cleaned … the <chore>": reads list_chores, then proposes
//     log_completion for every chore named in the text (the longest names
//     first), or asks which chore when none is.
//
// Anything else gets a short help line and no tool. It never touches the
// database itself: everything it knows comes from the tool results.

type Block = Anthropic.ContentBlock;

const LOG_VERBS =
  /\b(did|done|took|take|cleaned|clean|emptied|empty|log|logged|finished|vacuumed|washed|mopped|watered|unloaded|made)\b/;

let seq = 0;
const id = (prefix: string) => `${prefix}_fake_${++seq}`;

function message(
  model: string,
  content: Block[],
  stop: Anthropic.StopReason,
): Anthropic.Message {
  return {
    id: id("msg"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

const text = (t: string): Block =>
  ({ type: "text", text: t, citations: null }) as Block;

const toolUse = (name: string, input: Record<string, unknown>): Block =>
  ({ type: "tool_use", id: id("toolu"), name, input }) as Block;

/** The command: the last user turn that is plain text, not tool results. */
function commandIndex(messages: MessageParams["messages"]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return i;
  }
  return -1;
}

/** Each read tool's parsed result since the command, by tool name. */
function readsSince(
  messages: MessageParams["messages"],
  from: number,
): Map<string, unknown> {
  const names = new Map<string, string>();
  const out = new Map<string, unknown>();
  for (const m of messages.slice(from + 1)) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") names.set(b.id, b.name);
      if (b.type === "tool_result" && typeof b.content === "string") {
        const name = names.get(b.tool_use_id);
        if (name) out.set(name, JSON.parse(b.content));
      }
    }
  }
  return out;
}

interface ChoreLike {
  id: string;
  name: string;
}

/** The chores the text names, longest names first, each once. */
export function choresNamed(said: string, chores: ChoreLike[]): ChoreLike[] {
  let rest = said.toLowerCase();
  const found: ChoreLike[] = [];
  const byLength = [...chores].sort((a, b) => b.name.length - a.name.length);
  for (const c of byLength) {
    const name = c.name.toLowerCase();
    if (rest.includes(name)) {
      found.push(c);
      rest = rest.split(name).join(" ");
    }
  }
  return found;
}

export async function fakeClaude(
  params: MessageParams,
): Promise<Anthropic.Message> {
  const model = params.model;
  const at = commandIndex(params.messages);
  const said =
    at >= 0 ? (params.messages[at]!.content as string).toLowerCase() : "";
  const reads = readsSince(params.messages, at);
  const offered = new Set(
    (params.tools ?? []).map((t) => ("name" in t ? t.name : "")),
  );

  if (
    /\b(win|wins|winning|lead|leads|leading|standings|score|scores)\b/.test(
      said,
    )
  ) {
    const standings = reads.get("get_standings") as
      | {
          data?: {
            leaderId: string | null;
            standings: {
              memberId: string;
              displayName: string;
              points: number;
            }[];
          };
        }
      | undefined;
    if (!standings) {
      return message(model, [toolUse("get_standings", {})], "tool_use");
    }
    const table = standings.data?.standings ?? [];
    const leader = table.find((s) => s.memberId === standings.data?.leaderId);
    return message(
      model,
      [
        text(
          leader
            ? `${leader.displayName} is winning with ${leader.points} points.`
            : "Nobody is ahead right now. It's all to play for!",
        ),
      ],
      "end_turn",
    );
  }

  if (/\bconfirm\b/.test(said)) {
    const pending = reads.get("get_pending_confirmations") as
      | {
          data?: {
            claims: {
              completionId: string;
              choreName: string;
              doneByName: string;
              can: { confirm?: boolean };
            }[];
          };
        }
      | undefined;
    if (!pending) {
      return message(
        model,
        [toolUse("get_pending_confirmations", {})],
        "tool_use",
      );
    }
    const claim = pending.data?.claims.find((c) => c.can.confirm);
    if (!claim) {
      return message(
        model,
        [text("There is nothing waiting for your OK.")],
        "end_turn",
      );
    }
    return message(
      model,
      [
        text(
          `I've lined up confirming ${claim.doneByName}'s ${claim.choreName}.`,
        ),
        toolUse("confirm_completion", { completionId: claim.completionId }),
      ],
      "tool_use",
    );
  }

  if (LOG_VERBS.test(said) && offered.has("log_completion")) {
    const list = reads.get("list_chores") as
      { data?: { chores: ChoreLike[] } } | undefined;
    if (!list) {
      return message(model, [toolUse("list_chores", {})], "tool_use");
    }
    const named = choresNamed(said, list.data?.chores ?? []);
    if (named.length === 0) {
      return message(
        model,
        [text("Which chore was that? I couldn't find it on the list.")],
        "end_turn",
      );
    }
    return message(
      model,
      [
        text(
          `I've lined up logging ${named.map((c) => c.name).join(" and ")} for you. Tap approve.`,
        ),
        ...named.map((c) => toolUse("log_completion", { choreId: c.id })),
      ],
      "tool_use",
    );
  }

  return message(
    model,
    [text("Meow! Tell me which chore you did, or ask me who's winning.")],
    "end_turn",
  );
}
