// @vitest-environment node
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParams } from "./claude";
import {
  bountyNamed,
  choresNamed,
  fakeClaude,
  myDataSummary,
  potAmountNamed,
  shoppingItemsNamed,
} from "./claude-fake";

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

  it("proposes ONE add_shopping_items with every item named", async () => {
    const shop = [
      { name: "add_shopping_items", input_schema: { type: "object" as const } },
    ];
    const m = await fakeClaude(
      params([{ role: "user", content: "Baumy, add milk and eggs" }], shop),
    );
    expect(m.stop_reason).toBe("tool_use");
    expect(uses(m).map((u) => [u.name, u.input])).toEqual([
      ["add_shopping_items", { items: ["milk", "eggs"] }],
    ]);
    // Not offered: no shopping proposal.
    const off = await fakeClaude(
      params([{ role: "user", content: "add milk" }], []),
    );
    expect(uses(off)).toEqual([]);
  });

  it("proposes create_bounty and add_pot_contribution when offered (issue #107)", async () => {
    const offered = [
      { name: "create_bounty", input_schema: { type: "object" as const } },
      {
        name: "add_pot_contribution",
        input_schema: { type: "object" as const },
      },
      { name: "add_shopping_items", input_schema: { type: "object" as const } },
    ];
    const bounty = await fakeClaude(
      params(
        [
          {
            role: "user",
            content: "Add a bounty for recycling paper, 15 points",
          },
        ],
        offered,
      ),
    );
    expect(uses(bounty).map((u) => [u.name, u.input])).toEqual([
      ["create_bounty", { name: "Recycling paper", points: 15 }],
    ]);
    const pot = await fakeClaude(
      params([{ role: "user", content: "put €20 in the pot" }], offered),
    );
    expect(uses(pot).map((u) => [u.name, u.input])).toEqual([
      ["add_pot_contribution", { amount: "20" }],
    ]);
    // Not among the tools: no proposal.
    const none = await fakeClaude(
      params([{ role: "user", content: "put €20 in the pot" }]),
    );
    expect(uses(none)).toEqual([]);
  });

  it("reads a bounty's name and points, and a pot amount", () => {
    expect(
      bountyNamed("add a new bounty called Dish soap worth 10 pts"),
    ).toEqual({ name: "Dish soap", points: 10 });
    expect(bountyNamed("add a bounty for the bins")).toBeNull();
    expect(potAmountNamed("add 12.50 euros to the pot")).toBe("12.50");
    expect(potAmountNamed("put 5€ into the pot")).toBe("5");
    expect(potAmountNamed("how big is the pot?")).toBeNull();
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

  it("reads get_my_data for 'what do you keep about me', then sums it up with the policy (issue #144)", async () => {
    const offered = [
      ...tools,
      { name: "get_my_data", input_schema: { type: "object" as const } },
    ];
    const said = "What do you keep about me?";
    const first = await fakeClaude(
      params([{ role: "user", content: said }], offered),
    );
    expect(uses(first).map((u) => u.name)).toEqual(["get_my_data"]);

    const data = {
      sessions: { count: 1 },
      completions: { total: 3 },
      notes: { written: 2, deletedKept: 1 },
      photos: { stored: 1 },
      auditEntries: 7,
      ai: { commands: 4 },
      retention: { photoDays: 90, policyUrl: "/privacy" },
    };
    const second = await fakeClaude({
      ...afterRead(said, "get_my_data", { ok: true, data }),
      tools: offered,
    });
    expect(second.stop_reason).toBe("end_turn");
    expect(uses(second)).toEqual([]);
    expect(text(second)).toBe(myDataSummary(data));
    expect(text(second)).toContain("3 completions");
    expect(text(second)).toContain("2 notes (1 deleted but kept)");
    expect(text(second)).toContain("1 proof photo,");
    expect(text(second)).toContain("7 audit-log entries");
    expect(text(second)).toContain("1 signed-in device.");
    expect(text(second)).toContain("deleted 90 days after");
    expect(text(second)).toContain("/privacy");

    // Refused (the kitchen iPad): it says where to ask instead.
    const refused = await fakeClaude({
      ...afterRead(said, "get_my_data", { ok: false, code: "FORBIDDEN" }),
      tools: offered,
    });
    expect(text(refused)).toContain("your own phone");

    // Not offered: the help line, no tool.
    const notOffered = await fakeClaude(
      params([{ role: "user", content: said }]),
    );
    expect(uses(notOffered)).toEqual([]);
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

describe("shoppingItemsNamed", () => {
  it("reads the items after 'add', without the list's name", () => {
    expect(shoppingItemsNamed("baumy, add milk and eggs")).toEqual([
      "milk",
      "eggs",
    ]);
    expect(
      shoppingItemsNamed("add bread, oat milk and tea to the shopping list!"),
    ).toEqual(["bread", "oat milk", "tea"]);
    expect(shoppingItemsNamed("add coffee onto our list")).toEqual(["coffee"]);
    expect(shoppingItemsNamed("who is winning")).toEqual([]);
  });
});
