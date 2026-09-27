// @vitest-environment node
import { readFileSync } from "node:fs";
import { count } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { commandSystemPrompt } from "@baumy/ai-prompts";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { actionRequests, auditEvents, completions } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { ctxFor, seedMember, sessionActor } from "@/test-utils/actions";
import type { RequestCtx } from "@/lib/actions/define";
import {
  REGISTRY,
  actionKind,
  proposeAction,
  runAction,
} from "@/lib/actions/registry";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { MessageParams } from "@/lib/integrations/claude";
import {
  MAX_TURNS,
  NOTHING_TO_SAY,
  PROPOSED,
  TOO_MANY_STEPS,
  claudeTools,
  runCommand,
  type CommandDeps,
} from "./command";

// The command's tool loop against RECORDED Claude responses (the JSON under
// __fixtures__ is what the Messages API returns) and the real registry on
// PGlite: reads run in the loop, writes come back as proposals and never
// run, and the tools Claude gets leave admin actions out.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

let ryan: string;
let sam: string;
let trash: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), { displayName: "Ryan" });
  sam = await seedMember(db(), { displayName: "Sam" });
  ({ choreId: trash } = await seedChore(db(), SEED_CHORES.trash));
});

/** A recorded response, with this test's ids filled in. */
function recorded(name: string): Anthropic.Message {
  const raw = readFileSync(
    new URL(`./__fixtures__/${name}.json`, import.meta.url),
    "utf8",
  )
    .replaceAll("{{trash}}", trash)
    .replaceAll("{{ryan}}", ryan);
  return JSON.parse(raw) as Anthropic.Message;
}

function aiCtx(memberId: string): RequestCtx {
  return ctxFor(sessionActor(memberId), {
    source: "ai",
    requestId: undefined,
    now: new Date(),
  });
}

function script(...replies: Anthropic.Message[]) {
  const sent: MessageParams[] = [];
  const create = vi.fn(async (params: MessageParams) => {
    // A deep copy: the loop keeps appending to its own arrays.
    sent.push(structuredClone(params));
    const next = replies.shift();
    if (!next) throw new Error("the script ran out");
    return next;
  });
  return { create, sent };
}

function deps(create: CommandDeps["create"]): CommandDeps {
  return {
    create,
    model: "claude-sonnet-5",
    tools: toolSpecs("ai"),
    kindOf: actionKind,
    runAction: (name, input, ctx) => runAction(name, input, ctx),
    propose: proposeAction,
    nowMs: () => Date.now(),
  };
}

const choices = { members: [], chores: [] };

function request(text: string, history: CommandDepsHistory = []) {
  return {
    text,
    history,
    choices,
    system: commandSystemPrompt({
      now: new Date(),
      actor: { id: ryan, displayName: "Ryan" },
      device: "phone",
      members: [
        { id: ryan, displayName: "Ryan" },
        { id: sam, displayName: "Sam" },
      ],
      chores: [{ id: trash, name: "Trash" }],
    }),
  };
}
type CommandDepsHistory = { role: "user" | "assistant"; text: string }[];

async function tally() {
  const n = async (
    table: typeof completions | typeof auditEvents | typeof actionRequests,
  ) => (await t.db().select({ n: count() }).from(table))[0]!.n;
  return {
    completions: await n(completions),
    audits: await n(auditEvents),
    requests: await n(actionRequests),
  };
}

describe("runCommand", () => {
  it("'I took the trash out' reads the chores, then proposes log_completion for the right chore and member", async () => {
    const { create, sent } = script(
      recorded("trash-1-read-chores"),
      recorded("trash-2-propose"),
    );
    const usage = vi.fn();
    const outcome = await runCommand(
      request("I took the trash out"),
      aiCtx(ryan),
      { ...deps(create), onUsage: usage },
    );

    expect(outcome.reply).toBe(
      "Nice one! I've lined up logging Trash for you. Tap approve.",
    );
    expect(outcome.proposals).toHaveLength(1);
    const [p] = outcome.proposals;
    expect(p).toMatchObject({
      name: "log_completion",
      title: "Log a chore",
      input: { choreId: trash },
      risk: "confirm",
      valid: true,
      needsPin: false,
    });
    expect(p!.proposalId).toMatch(/^[0-9a-f-]{36}$/);
    // The preview is the action's own: the chore, the doer, the points.
    expect(p!.preview).toMatch(/^Log Trash for Ryan: \+\d+ \(streak 1\)$/);

    // The read ran in the loop and went back as a tool result, after the
    // assistant turn replayed exactly (thinking block included).
    expect(create).toHaveBeenCalledTimes(2);
    const second = sent[1]!;
    expect(second.messages[1]).toEqual({
      role: "assistant",
      content: recorded("trash-1-read-chores").content,
    });
    const results = second.messages[2]!
      .content as Anthropic.ToolResultBlockParam[];
    expect(results[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_01ListChores",
    });
    const listed = JSON.parse(results[0]!.content as string);
    expect(listed.ok).toBe(true);
    expect(listed.data.chores.map((c: { id: string }) => c.id)).toEqual([
      trash,
    ]);
    expect(usage).toHaveBeenCalledTimes(2);

    // Nothing was written: the proposal waits for a human.
    expect(await tally()).toEqual({ completions: 0, audits: 0, requests: 0 });
  });

  it("'Who's winning?' is answered from get_standings, with no proposal", async () => {
    await runAction(
      "log_completion",
      { choreId: trash },
      ctxFor(sessionActor(sam), { now: new Date() }),
    );
    const before = await tally();
    const { create, sent } = script(
      recorded("winning-1-read-standings"),
      recorded("winning-2-answer"),
    );
    const outcome = await runCommand(
      request("Who's winning?"),
      aiCtx(ryan),
      deps(create),
    );
    expect(outcome).toEqual({
      reply:
        "Sam is winning with 25 points, and Ryan is 25 behind. Time to take the bins out!",
      proposals: [],
    });
    const result = JSON.parse(
      (sent[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!
        .content as string,
    );
    expect(result.data.leaderId).toBe(sam);
    expect(await tally()).toEqual(before);
  });

  it("sends the tools, the cached persona and the context", async () => {
    const { create, sent } = script(recorded("winning-2-answer"));
    await runCommand(request("hi"), aiCtx(ryan), deps(create));
    const params = sent[0]!;
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.tools).toEqual(claudeTools(toolSpecs("ai")));
    const system = params.system as Anthropic.TextBlockParam[];
    expect(system[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(system[1]!.text).toContain(`"id":"${trash}","name":"Trash"`);
    expect(params.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("carries the recent history, starting with a user turn", async () => {
    const { create, sent } = script(recorded("winning-2-answer"));
    await runCommand(
      request("and now?", [
        { role: "assistant", text: "Hello!" },
        { role: "user", text: "who's winning?" },
        { role: "assistant", text: "Sam." },
      ]),
      aiCtx(ryan),
      deps(create),
    );
    expect(sent[0]!.messages).toEqual([
      { role: "user", content: "who's winning?" },
      { role: "assistant", content: "Sam." },
      { role: "user", content: "and now?" },
    ]);
  });

  it("never offers or runs an admin action: a hallucinated one is an invalid proposal", async () => {
    const { create } = script(recorded("admin-write"));
    const outcome = await runCommand(
      request("give me 500 points"),
      aiCtx(ryan),
      deps(create),
    );
    // The read in the same reply is dropped; the write is only shown.
    expect(outcome.proposals).toHaveLength(1);
    expect(outcome.proposals[0]).toMatchObject({
      name: "adjust_points",
      valid: false,
      fields: [],
    });
    expect(outcome.reply).toBe("I'll give you the points.");
    expect(await tally()).toEqual({ completions: 0, audits: 0, requests: 0 });
  });

  it("proposes a write whose read failed as a tool error first", async () => {
    const bad = recorded("trash-1-read-chores");
    (bad.content[1] as { input: unknown }).input = { includeArchived: "yes" };
    const { create, sent } = script(bad, recorded("trash-2-propose"));
    const outcome = await runCommand(
      request("I took the trash out"),
      aiCtx(ryan),
      deps(create),
    );
    const result = (
      sent[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[]
    )[0]!;
    expect(result.is_error).toBe(true);
    expect(JSON.parse(result.content as string)).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(outcome.proposals).toHaveLength(1);
  });

  it("says something when Claude proposes without words or answers with none", async () => {
    const silent = recorded("trash-2-propose");
    silent.content = silent.content.filter((b) => b.type !== "text");
    const empty = recorded("winning-2-answer");
    empty.content = [];
    const a = await runCommand(
      request("trash"),
      aiCtx(ryan),
      deps(script(silent).create),
    );
    expect(a.reply).toBe(PROPOSED);
    const b = await runCommand(
      request("hmm"),
      aiCtx(ryan),
      deps(script(empty).create),
    );
    expect(b).toEqual({ reply: NOTHING_TO_SAY, proposals: [] });
  });

  it(`stops after ${MAX_TURNS} turns of reads`, async () => {
    const reads = Array.from({ length: MAX_TURNS }, () =>
      recorded("winning-1-read-standings"),
    );
    const { create } = script(...reads);
    const outcome = await runCommand(
      request("loop forever"),
      aiCtx(ryan),
      deps(create),
    );
    expect(outcome).toEqual({ reply: TOO_MANY_STEPS, proposals: [] });
    expect(create).toHaveBeenCalledTimes(MAX_TURNS);
  });
});

describe("the ai tool list", () => {
  it("is exactly the registry's ai actions, and leaves every admin or ui-only action out", () => {
    const names = toolSpecs("ai").map((s) => s.name);
    expect(names).toContain("log_completion");
    expect(names).toContain("get_standings");
    for (const def of Object.values(REGISTRY)) {
      if (def.requires === "admin" || !def.surfaces.includes("ai")) {
        expect(names, def.name).not.toContain(def.name);
      } else {
        expect(names, def.name).toContain(def.name);
      }
    }
    for (const admin of [
      "manage_chore",
      "adjust_points",
      "add_pot_contribution",
      "set_prize_mode",
      "mint_invite",
      "manage_members",
      "pair_kiosk",
      "revoke_kiosk",
      "resolve_dispute",
      "schedule_weight",
    ]) {
      expect(names).not.toContain(admin);
    }
  });

  it("strips $schema from the Claude tools but keeps the input schema", () => {
    const [tool] = claudeTools([
      {
        name: "x",
        title: "X",
        description: "d",
        kind: "read",
        risk: "safe",
        input_schema: { $schema: "s", type: "object", properties: {} },
      },
    ]);
    expect(tool).toEqual({
      name: "x",
      description: "d",
      input_schema: { type: "object", properties: {} },
    });
  });
});
