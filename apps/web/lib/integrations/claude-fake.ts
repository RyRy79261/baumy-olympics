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
//   - "confirm …" or "dispute …": reads get_pending_confirmations, then
//     proposes confirm_completion (or dispute_completion, with the reason
//     "Baumy heard it was not done") for the claim the asker may confirm
//     (or dispute) whose chore the text names (else the first one);
//   - "add a note: <title>": proposes create_note (issue #145);
//   - "I did/took/cleaned … the <chore>": reads list_chores, then proposes
//     log_completion for every chore named in the text (the longest names
//     first), or asks which chore when none is;
//   - "add milk and eggs (to the list)": proposes ONE add_shopping_items
//     with every item named (issue #26);
//   - "add a bounty for <name>, <N> points": proposes create_bounty
//     (issue #107);
//   - "put €<X> in the pot": proposes add_pot_contribution (issue #107).
//
// Anything else gets a short help line and no tool. It never touches the
// database itself: everything it knows comes from the tool results.

type Block = Anthropic.ContentBlock;

const LOG_VERBS =
  /\b(did|done|took|take|cleaned|clean|emptied|empty|log|logged|finished|vacuumed|washed|mopped|watered|unloaded|made)\b/;

/** "add milk, eggs and bread to the shopping list" → the part to add. */
const ADD_SHOPPING =
  /\badd\s+(.+?)(?:\s+(?:on)?to\s+(?:the\s+|our\s+)?(?:shopping\s+)?list)?[\s.!?]*$/;

/** The items named in "milk, eggs and bread". */
export function shoppingItemsNamed(said: string): string[] {
  const m = ADD_SHOPPING.exec(said);
  if (!m) return [];
  return m[1]!
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** "add a note: Bins go out Tuesday" → the note's title. */
const NOTE = /\b(?:add|make|write)\s+(?:a\s+)?note[:\s]+(.+?)[\s.!?]*$/i;

/** "add a bounty for Recycling paper, 15 points" → its name and points. */
const ADD_BOUNTY =
  /\badd\s+(?:a\s+|new\s+)*bounty\s+(?:for\s+|called\s+)?(.+?)[\s,]+(?:worth\s+)?(\d{1,3})\s*(?:points?|pts)\b/i;

export function bountyNamed(
  said: string,
): { name: string; points: number } | null {
  const m = ADD_BOUNTY.exec(said);
  if (!m) return null;
  const name = m[1]!.trim();
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    points: Number(m[2]),
  };
}

/** "put €20 in the pot", "add 12.50 euros to the pot" → "20", "12.50". */
const POT_AMOUNT =
  /\b(?:put|add)\s+€?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros?)?\s+(?:in|into|to)\s+the\s+pot\b/i;

export function potAmountNamed(said: string): string | null {
  return POT_AMOUNT.exec(said)?.[1] ?? null;
}

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
  const original = at >= 0 ? (params.messages[at]!.content as string) : "";
  const said = original.toLowerCase();
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

  const note = offered.has("create_note") ? NOTE.exec(original) : null;
  if (note) {
    const title = note[1]!.trim();
    return message(
      model,
      [
        text(`I've lined up the note "${title}". Tap Confirm all.`),
        toolUse("create_note", { title }),
      ],
      "tool_use",
    );
  }

  const disputing = /\bdispute\b/.test(said);
  if (disputing || /\bconfirm\b/.test(said)) {
    const pending = reads.get("get_pending_confirmations") as
      | {
          data?: {
            claims: {
              completionId: string;
              choreName: string;
              doneByName: string;
              can: { confirm?: boolean; dispute?: boolean };
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
    const mine = (pending.data?.claims ?? []).filter((c) =>
      disputing ? c.can.dispute : c.can.confirm,
    );
    // The claim whose chore the text names, else the first one.
    const claim =
      mine.find((c) => said.includes(c.choreName.toLowerCase())) ?? mine[0];
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
          `I've lined up ${disputing ? "disputing" : "confirming"} ${claim.doneByName}'s ${claim.choreName}.`,
        ),
        disputing
          ? toolUse("dispute_completion", {
              completionId: claim.completionId,
              reason: "Baumy heard it was not done",
            })
          : toolUse("confirm_completion", { completionId: claim.completionId }),
      ],
      "tool_use",
    );
  }

  const bounty = offered.has("create_bounty") ? bountyNamed(original) : null;
  if (bounty) {
    return message(
      model,
      [
        text(`I've lined up a new bounty: ${bounty.name}. Confirm it below.`),
        toolUse("create_bounty", bounty),
      ],
      "tool_use",
    );
  }

  const pot = offered.has("add_pot_contribution") ? potAmountNamed(said) : null;
  if (pot) {
    return message(
      model,
      [
        text(`I've lined up €${pot} for the pot. Confirm it below.`),
        toolUse("add_pot_contribution", { amount: pot }),
      ],
      "tool_use",
    );
  }

  const shopping = offered.has("add_shopping_items")
    ? shoppingItemsNamed(said)
    : [];
  if (shopping.length > 0) {
    return message(
      model,
      [
        text("I've lined up the shopping list for you. Tap Confirm all."),
        toolUse("add_shopping_items", { items: shopping }),
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
          `I've lined up logging ${named.map((c) => c.name).join(" and ")} for you. Tap Confirm all.`,
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
