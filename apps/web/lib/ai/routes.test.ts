// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { actionRequests, completions } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { RequestCtx } from "@/lib/actions/define";
import { actionKind, proposeAction, runAction } from "@/lib/actions/registry";
import { toolSpecs } from "@/lib/actions/tool-specs";
import type { ClaudeClient } from "@/lib/integrations/claude";
import { fakeClaude } from "@/lib/integrations/claude-fake";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { AiRefusalError } from "./claude-call";
import type { Proposal } from "./proposal";
import {
  handleCommand,
  handleProposal,
  handleRunAction,
  type CommandRouteDeps,
  type RunRouteDeps,
} from "./routes";

// The three AI routes end to end on PGlite, with the scripted fake Claude
// (lib/integrations/claude-fake.ts) and the real registry: the command
// proposes, only /api/actions/run writes, a proposal approved twice is
// logged once, and on the kiosk a confirmation needs the member's PIN.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const PIN = "2580";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

let ryan: string;
let sam: string;
let trash: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), { displayName: "Ryan", kioskPinHash: pinHash });
  sam = await seedMember(db(), { displayName: "Sam", kioskPinHash: pinHash });
  ({ choreId: trash } = await seedChore(db(), SEED_CHORES.trash));
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Who is asking, per surface: Ryan's phone, or the kiosk with someone. */
let phoneMember: string | undefined;
let phoneRole: "admin" | "member" = "member";
let kioskMember: string | undefined;
const requestCtx: RunRouteDeps["requestCtx"] = async (
  surface,
  requestId,
  pin,
) => {
  if (surface === "kiosk") {
    return ctxFor(kioskActor(kioskMember), {
      requestId,
      now: new Date(),
      ...(pin ? { pin } : {}),
    });
  }
  if (phoneMember === undefined) return null;
  return ctxFor(sessionActor(phoneMember, phoneRole), {
    requestId,
    now: new Date(),
  });
};

beforeEach(() => {
  phoneMember = ryan;
  phoneRole = "member";
  kioskMember = ryan;
});

const loadHousehold = async () => ({
  members: [
    { id: ryan, displayName: "Ryan" },
    { id: sam, displayName: "Sam" },
  ],
  chores: [{ id: trash, name: "Trash" }],
});

function commandDeps(over: Partial<CommandRouteDeps> = {}): CommandRouteDeps {
  return {
    requestCtx,
    loadHousehold,
    logError: vi.fn(),
    claude: () => ({ ok: true, kind: "fake", create: fakeClaude }),
    model: "claude-sonnet-5",
    dailyLimit: () => 5,
    claim: vi.fn(async () => ({ ok: true as const, usageId: "u-1", used: 1 })),
    recordTokens: vi.fn(async () => {}),
    loop: {
      tools: toolSpecs("ai"),
      kindOf: actionKind,
      runAction: (name, input, ctx) => runAction(name, input, ctx),
      propose: proposeAction,
      nowMs: () => Date.now(),
    },
    ...over,
  };
}

const runDeps: RunRouteDeps = {
  requestCtx,
  runAction: (name, input, ctx) => runAction(name, input, ctx),
};

async function body(res: Response) {
  return (await res.json()) as {
    ok: boolean;
    code?: string;
    message?: string;
    data?: {
      reply: string;
      proposals: Proposal[];
      choices: unknown;
    } & Record<string, unknown>;
  };
}

async function completionCount() {
  return (await t.db().select({ n: count() }).from(completions))[0]!.n;
}

describe("POST /api/ai/command", () => {
  it("'I took the trash out' proposes log_completion; nothing is logged until it is approved", async () => {
    const deps = commandDeps();
    const res = await handleCommand(
      post({ text: "I took the trash out" }),
      deps,
    );
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.ok).toBe(true);
    expect(b.data!.reply).toContain("Trash");
    expect(b.data!.proposals).toHaveLength(1);
    const p = b.data!.proposals[0]!;
    expect(p).toMatchObject({
      name: "log_completion",
      input: { choreId: trash },
      valid: true,
    });
    expect(p.preview).toMatch(/^Log Trash for Ryan: \+\d+ \(streak 1\)$/);
    expect(b.data!.choices).toEqual({
      members: [
        { value: ryan, label: "Ryan" },
        { value: sam, label: "Sam" },
      ],
      chores: [{ value: trash, label: "Trash" }],
    });
    expect(deps.claim).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ai" }),
      "claude-sonnet-5",
      5,
    );
    // Two fake calls: the read, then the proposal.
    expect(deps.recordTokens).toHaveBeenCalledWith("u-1", {
      inputTokens: 200,
      outputTokens: 40,
    });
    expect(await completionCount()).toBe(0);

    // Approving it logs it, with the points the preview showed.
    const run = await handleRunAction(
      post({ name: p.name, input: p.input, requestId: p.proposalId }),
      runDeps,
    );
    const r = await body(run);
    expect(r).toMatchObject({
      ok: true,
      data: { choreId: trash, doneBy: ryan },
    });
    expect(p.preview).toContain(`+${String(r.data!.totalPts)} `);
    const [row] = await t.db().select().from(completions);
    expect(row).toMatchObject({ source: "ai", doneBy: ryan });
  });

  it("'Who's winning?' is answered with no proposal", async () => {
    await runAction(
      "log_completion",
      { choreId: trash },
      ctxFor(sessionActor(sam), { now: new Date() }),
    );
    const res = await handleCommand(
      post({ text: "Who's winning?" }),
      commandDeps(),
    );
    const b = await body(res);
    expect(b.data!.reply).toMatch(/^Sam is winning with \d+ points\.$/);
    expect(b.data!.proposals).toEqual([]);
  });

  it("refuses a cross-site request before anything else", async () => {
    const deps = commandDeps();
    const res = await handleCommand(
      post({ text: "hi" }, { "sec-fetch-site": "cross-site" }),
      deps,
    );
    expect(res.status).toBe(403);
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid", async () => {
    for (const bad of ["not json", { text: "   " }, { text: "hi", extra: 1 }]) {
      const res = await handleCommand(post(bad), commandDeps());
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect((await body(res)).code).toBe("INVALID_INPUT");
    }
  });

  it("needs someone signed in, and on the kiosk someone picked", async () => {
    phoneMember = undefined;
    const res = await handleCommand(post({ text: "hi" }), commandDeps());
    expect(res.status).toBe(401);
    kioskMember = undefined;
    const kiosk = await handleCommand(
      post({ text: "hi", surface: "kiosk" }),
      commandDeps(),
    );
    expect(kiosk.status).toBe(403);
    expect((await body(kiosk)).message).toBe(
      "Tap your avatar first, then ask Baumy.",
    );
  });

  it("refuses a signed-in account that is not a member", async () => {
    const res = await handleCommand(post({ text: "hi" }), {
      ...commandDeps(),
      requestCtx: async () =>
        ctxFor(sessionActor(undefined), { now: new Date() }),
    });
    expect(res.status).toBe(403);
  });

  it("says so when Claude is not configured, and claims nothing", async () => {
    const deps = commandDeps({
      claude: (): ClaudeClient => ({ ok: false, reason: "not_configured" }),
    });
    const res = await handleCommand(post({ text: "hi" }), deps);
    expect(res.status).toBe(501);
    expect((await body(res)).code).toBe("NOT_CONFIGURED");
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("stops at the daily limit, and says when the command is off", async () => {
    const claim = vi.fn(async () => ({ ok: false as const, used: 5 }));
    const res = await handleCommand(
      post({ text: "hi" }),
      commandDeps({ claim }),
    );
    expect(res.status).toBe(429);
    expect((await body(res)).message).toContain("5 times today");
    const off = await handleCommand(
      post({ text: "hi" }),
      commandDeps({ claim, dailyLimit: () => 0 }),
    );
    expect((await body(off)).message).toContain("switched off");
  });

  it("maps a refusal to 422 and still records the tokens spent", async () => {
    const deps = commandDeps({
      claude: () => ({
        ok: true,
        kind: "fake",
        create: async () => {
          throw new AiRefusalError("cyber");
        },
      }),
    });
    const res = await handleCommand(post({ text: "hi" }), deps);
    expect(res.status).toBe(422);
    expect((await body(res)).code).toBe("AI_REFUSED");
    expect(deps.recordTokens).toHaveBeenCalledWith("u-1", {
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("answers a generic 502 for anything else, without leaking it", async () => {
    const logError = vi.fn();
    const deps = commandDeps({
      logError,
      recordTokens: vi.fn(async () => {
        throw new Error("db down");
      }),
      claude: () => ({
        ok: true,
        kind: "fake",
        create: async () => {
          throw Anthropic.APIError.generate(
            400,
            { error: { type: "invalid_request_error" } },
            "sql: select secret",
            new Headers(),
          );
        },
      }),
    });
    const res = await handleCommand(post({ text: "hi" }), deps);
    expect(res.status).toBe(502);
    const b = await body(res);
    expect(b.code).toBe("INTERNAL");
    expect(b.message).not.toContain("secret");
    expect(logError).toHaveBeenCalledWith(
      "[ai:command] could not record usage",
      expect.any(Error),
    );
  });

  it("names the kiosk and the acting member in the prompt", async () => {
    const create = vi.fn(fakeClaude);
    kioskMember = sam;
    await handleCommand(
      post({ text: "hello", surface: "kiosk" }),
      commandDeps({ claude: () => ({ ok: true, kind: "fake", create }) }),
    );
    const system = create.mock.calls[0]![0].system as { text: string }[];
    expect(system[1]!.text).toContain(`"id":"${sam}","name":"Sam"`);
    expect(system[1]!.text).toContain("kitchen iPad");
    expect(system[1]!.text).toContain("The acting member is not an admin.");
  });

  it("tells Claude when the phone's member is an admin (issue #107)", async () => {
    const create = vi.fn(fakeClaude);
    phoneRole = "admin";
    await handleCommand(
      post({ text: "hello" }),
      commandDeps({ claude: () => ({ ok: true, kind: "fake", create }) }),
    );
    const system = create.mock.calls[0]![0].system as { text: string }[];
    expect(system[1]!.text).toContain(
      "The acting member is a household admin.",
    );
  });
});

describe("POST /api/actions/run", () => {
  it("approving the same proposal twice logs it once", async () => {
    const requestId = "5b1d7c3e-0a5c-4a7a-9f55-0e6b3f2d9c11";
    const req = () =>
      post({ name: "log_completion", input: { choreId: trash }, requestId });
    const first = await body(await handleRunAction(req(), runDeps));
    const again = await body(await handleRunAction(req(), runDeps));
    expect(first.ok).toBe(true);
    expect(again).toEqual(first);
    expect(await completionCount()).toBe(1);
    const [ledger] = await t
      .db()
      .select()
      .from(actionRequests)
      .where(eq(actionRequests.requestId, requestId));
    expect(ledger).toMatchObject({ source: "ai", status: "done" });
  });

  it("on the kiosk, confirming someone's completion needs the PIN", async () => {
    const logged = await runAction(
      "log_completion",
      { choreId: trash },
      ctxFor(sessionActor(sam), { now: new Date() }),
    );
    if (!logged.ok) throw new Error(logged.message);
    const confirm = (pin?: string) =>
      post({
        name: "confirm_completion",
        input: { completionId: logged.data.completionId },
        requestId: "confirm-proposal-1",
        surface: "kiosk",
        ...(pin ? { pin } : {}),
      });

    const noPin = await body(await handleRunAction(confirm(), runDeps));
    expect(noPin).toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    const wrong = await body(await handleRunAction(confirm("1111"), runDeps));
    expect(wrong).toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    const [before] = await t.db().select().from(completions);
    expect(before!.status).toBe("pending");

    const ok = await body(await handleRunAction(confirm(PIN), runDeps));
    expect(ok.ok).toBe(true);
    const [after] = await t.db().select().from(completions);
    expect(after!.status).toBe("confirmed");
    expect(after!.verifiedBy).toBe(ryan);
  });

  it("never sends a PIN from the phone", async () => {
    const runAction = vi.fn(async () => ({ ok: true as const, data: null }));
    await handleRunAction(
      post({ name: "whoami", requestId: "phone-req-1", pin: "2580" }),
      { requestCtx, runAction },
    );
    const ctx = (
      runAction.mock.calls[0] as unknown as [string, unknown, RequestCtx]
    )[2];
    expect(ctx.pin).toBeUndefined();
    expect(ctx.source).toBe("ai");
  });

  it("refuses admin actions, which are not offered to the AI", async () => {
    const res = await body(
      await handleRunAction(
        post({
          name: "adjust_points",
          input: { op: "create", memberId: ryan, points: 5, reason: "x" },
          requestId: "admin-req-1",
        }),
        runDeps,
      ),
    );
    expect(res).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
  });

  it("checks the origin, the body and who is asking", async () => {
    expect(
      (
        await handleRunAction(
          post(
            { name: "whoami", requestId: "r-1234567" },
            { "sec-fetch-site": "cross-site" },
          ),
          runDeps,
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleRunAction(post({ name: "whoami" }), runDeps)).status,
    ).toBe(400);
    phoneMember = undefined;
    expect(
      (
        await handleRunAction(
          post({ name: "whoami", requestId: "r-1234567" }),
          runDeps,
        )
      ).status,
    ).toBe(401);
  });
});

describe("POST /api/ai/proposal", () => {
  const deps = () => ({
    requestCtx,
    loadHousehold,
    logError: vi.fn(),
    propose: proposeAction,
  });

  it("re-checks and re-previews an edited proposal", async () => {
    const res = await handleProposal(
      post({ name: "log_completion", input: { choreId: trash, doneBy: sam } }),
      deps(),
    );
    const b = (await res.json()) as { ok: boolean; data: Proposal };
    expect(b.ok).toBe(true);
    expect(b.data).toMatchObject({ valid: true, needsPin: false });
    expect(b.data.preview).toMatch(/^Log Trash for Sam/);
    expect(await completionCount()).toBe(0);
  });

  it("flags the PIN on the kiosk", async () => {
    const res = await handleProposal(
      post({
        name: "log_completion",
        input: { choreId: trash, doneBy: sam },
        surface: "kiosk",
      }),
      deps(),
    );
    expect(((await res.json()) as { data: Proposal }).data.needsPin).toBe(true);
  });

  it("refuses bad requests and answers 500 when the household cannot be read", async () => {
    expect(
      (
        await handleProposal(
          post({ name: "x" }, { "sec-fetch-site": "cross-site" }),
          deps(),
        )
      ).status,
    ).toBe(403);
    expect((await handleProposal(post({ name: "x" }), deps())).status).toBe(
      400,
    );
    phoneMember = undefined;
    expect(
      (await handleProposal(post({ name: "x", input: {} }), deps())).status,
    ).toBe(401);
    phoneMember = ryan;
    const broken = await handleProposal(post({ name: "x", input: {} }), {
      ...deps(),
      loadHousehold: async () => {
        throw new Error("db down");
      },
    });
    expect(broken.status).toBe(500);
  });
});
