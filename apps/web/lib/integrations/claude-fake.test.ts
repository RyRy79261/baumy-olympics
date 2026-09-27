// @vitest-environment node
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParams } from "./claude";
import { choresNamed, fakeClaude } from "./claude-fake";

// The e2e fake Claude answers in real Messages API shapes, and only from
// the tool results it is sent.

const tools = [
  { name: "log_completion", input_schema: { type: "object" as const } },
];

function params(
  messages: MessageParams["messages"],
  withTools = tools,
): MessageParams {
  return { model: "fake", max_tokens: 100, tools: withTools, messages };
}

function uses(m: Anthropic.Message) {
  return m.content.filter(
    (b) => b.type === "tool_use",
  ) as Anthropic.ToolUseBlock[];
}

function text(m: Anthropic.Message) {
  return m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ");
}

/** The conversation after one read: the tool call and its result. */
function afterRead(said: string, name: string, result: unknown) {
  return params([
    { role: "user", content: said },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name, input: {} }],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: JSON.stringify(result),
        },
      ],
    },
  ]);
}

describe("fakeClaude", () => {
  it("reads the chores, then proposes a log for each chore named", async () => {
    const first = await fakeClaude(
      params([{ role: "user", content: "I did the Trash and the dishes" }]),
    );
    expect(first.stop_reason).toBe("tool_use");
    expect(uses(first).map((u) => u.name)).toEqual(["list_chores"]);

    const second = await fakeClaude(
      afterRead("I did the Trash and the dishes", "list_chores", {
        ok: true,
        data: {
          chores: [
            { id: "c1", name: "Trash" },
            { id: "c2", name: "Dishes" },
            { id: "c3", name: "Dishwasher (unload)" },
          ],
        },
      }),
    );
    expect(uses(second).map((u) => u.input)).toEqual([
      { choreId: "c2" },
      { choreId: "c1" },
    ]);
    expect(text(second)).toContain("Dishes and Trash");
  });

  it("asks which chore when none is named", async () => {
    const m = await fakeClaude(
      afterRead("I did the thing", "list_chores", {
        ok: true,
        data: { chores: [{ id: "c1", name: "Trash" }] },
      }),
    );
    expect(uses(m)).toEqual([]);
    expect(text(m)).toContain("Which chore");
  });

  it("answers who is winning from get_standings", async () => {
    const first = await fakeClaude(
      params([{ role: "user", content: "Who's winning?" }]),
    );
    expect(uses(first)[0]!.name).toBe("get_standings");
    const lead = await fakeClaude(
      afterRead("Who's winning?", "get_standings", {
        ok: true,
        data: {
          leaderId: "m2",
          standings: [
            { memberId: "m2", displayName: "Sam", points: 30 },
            { memberId: "m1", displayName: "Ryan", points: 10 },
          ],
        },
      }),
    );
    expect(lead.stop_reason).toBe("end_turn");
    expect(text(lead)).toBe("Sam is winning with 30 points.");
    const tie = await fakeClaude(
      afterRead("who leads", "get_standings", {
        ok: true,
        data: { leaderId: null, standings: [] },
      }),
    );
    expect(text(tie)).toContain("Nobody is ahead");
  });

  it("proposes confirming the first claim the asker may confirm", async () => {
    const first = await fakeClaude(
      params([{ role: "user", content: "confirm it" }]),
    );
    expect(uses(first)[0]!.name).toBe("get_pending_confirmations");
    const m = await fakeClaude(
      afterRead("confirm it", "get_pending_confirmations", {
        ok: true,
        data: {
          claims: [
            {
              completionId: "x0",
              choreName: "Mop",
              doneByName: "Me",
              can: { confirm: false },
            },
            {
              completionId: "x1",
              choreName: "Trash",
              doneByName: "Sam",
              can: { confirm: true },
            },
          ],
        },
      }),
    );
    expect(uses(m)[0]).toMatchObject({
      name: "confirm_completion",
      input: { completionId: "x1" },
    });
    const named = await fakeClaude(
      afterRead("confirm the mop", "get_pending_confirmations", {
        ok: true,
        data: {
          claims: [
            {
              completionId: "y1",
              choreName: "Trash",
              doneByName: "Sam",
              can: { confirm: true },
            },
            {
              completionId: "y2",
              choreName: "Mop",
              doneByName: "Sam",
              can: { confirm: true },
            },
          ],
        },
      }),
    );
    expect(uses(named)[0]!.input).toEqual({ completionId: "y2" });
    const none = await fakeClaude(
      afterRead("confirm it", "get_pending_confirmations", {
        ok: true,
        data: { claims: [] },
      }),
    );
    expect(text(none)).toContain("nothing waiting");
  });

  it("gives a help line for anything else, or when logging is not offered", async () => {
    const hi = await fakeClaude(params([{ role: "user", content: "hello" }]));
    expect(hi.stop_reason).toBe("end_turn");
    expect(text(hi)).toContain("Meow");
    const noTool = await fakeClaude(
      params([{ role: "user", content: "I did the trash" }], []),
    );
    expect(uses(noTool)).toEqual([]);
    const empty = await fakeClaude(params([]));
    expect(text(empty)).toContain("Meow");
  });
});

describe("choresNamed", () => {
  it("prefers the longest names and names each chore once", () => {
    const chores = [
      { id: "a", name: "Dishes" },
      { id: "b", name: "Dishwasher (unload)" },
    ];
    expect(choresNamed("I did the dishwasher (unload)", chores)).toEqual([
      chores[1],
    ]);
    expect(choresNamed("nothing", chores)).toEqual([]);
  });
});
