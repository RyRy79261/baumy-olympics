import { describe, expect, it, vi } from "vitest";
import type { RequestCtx } from "@/lib/actions/define";
import { fail, type ActionResult } from "@/lib/actions/result";
import { toolSpecs, type ToolSpec } from "@/lib/actions/tool-specs";
import {
  MCP_GENERIC_ERROR,
  MCP_TOOL_UNAVAILABLE,
  callMcpTool,
  callerFromAuthInfo,
  ipFromHeaders,
  mcpTool,
  toAuthInfo,
  toCallToolResult,
  toolsForScopes,
  type McpCaller,
  type McpToolDeps,
} from "./tools";

// Scope filtering and error mapping for the MCP tools (issue #24).

const NOW = new Date("2026-09-27T10:00:00.000Z");
const READ = "baumy:read";
const WRITE = "baumy:write";

const caller = (scopes: string[]): McpCaller => ({
  memberId: "11111111-1111-4111-8111-111111111111",
  scopes,
  clientId: "client-1",
});

function deps(
  run: McpToolDeps["runAction"] = async () => ({ ok: true, data: { n: 1 } }),
): McpToolDeps & { runAction: ReturnType<typeof vi.fn> } {
  return {
    specs: () => toolSpecs("mcp"),
    runAction: vi.fn(run),
    householdId: "house-1",
    now: () => NOW,
    newRequestId: () => "req-fresh",
    logError: vi.fn(),
  };
}

const textOf = (r: { content: unknown[] }) =>
  JSON.parse((r.content[0] as { text: string }).text) as Record<
    string,
    unknown
  >;

describe("toolsForScopes", () => {
  const specs = toolSpecs("mcp");
  const names = (scopes: string[]) =>
    toolsForScopes(specs, scopes).map((s) => s.name);

  it("lists the read tools for baumy:read and no write tool", () => {
    const read = names([READ]);
    expect(read).toContain("get_standings");
    expect(read).toContain("whoami");
    expect(read).not.toContain("log_completion");
    expect(toolsForScopes(specs, [READ]).every((s) => s.kind === "read")).toBe(
      true,
    );
  });

  it("adds the write tools with baumy:write", () => {
    const both = names([READ, WRITE]);
    expect(both).toContain("get_standings");
    expect(both).toContain("log_completion");
    expect(both).toHaveLength(specs.length);
  });

  it("lists only writes for a write-only token, and nothing for no scope", () => {
    expect(names([WRITE])).toContain("log_completion");
    expect(names([WRITE])).not.toContain("get_standings");
    expect(names([])).toEqual([]);
    expect(names(["other:scope"])).toEqual([]);
  });

  it("never lists a destructive or admin action", () => {
    const all = names([READ, WRITE]);
    expect(all).toContain("create_note");
    for (const hidden of [
      "delete_note",
      "delete_event",
      "manage_chore",
      "adjust_points",
      "resolve_dispute",
      "authorize_mcp_client",
    ]) {
      expect(all).not.toContain(hidden);
    }
  });
});

describe("mcpTool", () => {
  const spec = (kind: ToolSpec["kind"]): ToolSpec => ({
    name: "x",
    title: "X",
    description: "Does x.",
    input_schema: { type: "object", properties: {} },
    kind,
    risk: "safe",
  });

  it("marks reads read-only and nothing destructive", () => {
    expect(mcpTool(spec("read"))).toEqual({
      name: "x",
      title: "X",
      description: "Does x.",
      inputSchema: { type: "object", properties: {} },
      annotations: {
        title: "X",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    });
    expect(mcpTool(spec("write")).annotations?.readOnlyHint).toBe(false);
  });
});

describe("toCallToolResult", () => {
  it("returns the data as JSON text", () => {
    const r = toCallToolResult({ ok: true, data: { total: 3 } });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toEqual({ total: 3 });
    expect(textOf(toCallToolResult({ ok: true, data: undefined }))).toBe(null);
  });

  it("keeps an action's code, sentence, issues and retry time", () => {
    const r = toCallToolResult(
      fail("COOLDOWN", "Trash was done too recently.", {
        retryAt: "2026-09-27T12:00:00.000Z",
        retryAfterSeconds: 60,
        issues: [{ path: ["choreId"], message: "Pick a chore." }],
      }),
    );
    expect(r.isError).toBe(true);
    expect(textOf(r)).toEqual({
      ok: false,
      code: "COOLDOWN",
      message: "Trash was done too recently.",
      retryAt: "2026-09-27T12:00:00.000Z",
      retryAfterSeconds: 60,
      issues: [{ path: ["choreId"], message: "Pick a chore." }],
    });
  });

  it("drops anything else a failure carries", () => {
    const leaky = {
      ...fail("NOT_FOUND", "No such chore."),
      stack: "at db.query (select * from chores)",
    } as ActionResult<unknown>;
    expect(textOf(toCallToolResult(leaky))).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "No such chore.",
    });
  });

  it("gives INTERNAL the fixed sentence whatever its message says", () => {
    const r = toCallToolResult(
      fail("INTERNAL", 'relation "completions" does not exist'),
    );
    expect(textOf(r)).toEqual({
      ok: false,
      code: "INTERNAL",
      message: MCP_GENERIC_ERROR,
    });
  });
});

describe("callMcpTool", () => {
  it("runs a read as the token's member from the mcp surface, with no request id", async () => {
    const d = deps();
    const r = await callMcpTool(
      "get_standings",
      { seasonId: "s" },
      caller([READ]),
      "203.0.113.9",
      d,
    );
    expect(textOf(r)).toEqual({ n: 1 });
    const [name, input, ctx] = d.runAction.mock.calls[0] as [
      string,
      unknown,
      RequestCtx,
    ];
    expect(name).toBe("get_standings");
    expect(input).toEqual({ seasonId: "s" });
    expect(ctx).toEqual({
      actor: {
        kind: "mcp",
        memberId: caller([READ]).memberId,
        scopes: [READ],
      },
      source: "mcp",
      householdId: "house-1",
      ip: "203.0.113.9",
      now: NOW,
    });
  });

  it("gives every write call a fresh request id", async () => {
    const d = deps();
    await callMcpTool(
      "log_completion",
      undefined,
      caller([READ, WRITE]),
      undefined,
      d,
    );
    const [, input, ctx] = d.runAction.mock.calls[0] as [
      string,
      unknown,
      RequestCtx,
    ];
    expect(input).toEqual({});
    expect(ctx.requestId).toBe("req-fresh");
    expect(ctx.source).toBe("mcp");
    expect(ctx).not.toHaveProperty("ip");
  });

  it("refuses a write tool to a read-only token like a tool that does not exist", async () => {
    const d = deps();
    const write = await callMcpTool(
      "log_completion",
      {},
      caller([READ]),
      undefined,
      d,
    );
    const unknown = await callMcpTool(
      "drop_tables",
      {},
      caller([READ, WRITE]),
      undefined,
      d,
    );
    expect(write).toEqual(unknown);
    expect(write.isError).toBe(true);
    expect(textOf(write)).toEqual({
      ok: false,
      code: "UNKNOWN_ACTION",
      message: MCP_TOOL_UNAVAILABLE,
    });
    expect(d.runAction).not.toHaveBeenCalled();
  });

  it("refuses a destructive tool even with both scopes", async () => {
    const d = deps();
    const r = await callMcpTool(
      "delete_note",
      { noteId: "n" },
      caller([READ, WRITE]),
      undefined,
      d,
    );
    expect(textOf(r)).toMatchObject({ code: "UNKNOWN_ACTION" });
    expect(d.runAction).not.toHaveBeenCalled();
  });

  it("refuses a call without a caller", async () => {
    const d = deps();
    const r = await callMcpTool("whoami", {}, null, undefined, d);
    expect(textOf(r)).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(d.runAction).not.toHaveBeenCalled();
  });

  it("maps an action's failure", async () => {
    const d = deps(async () => fail("COOLDOWN", "Too soon."));
    const r = await callMcpTool(
      "log_completion",
      {},
      caller([WRITE]),
      undefined,
      d,
    );
    expect(r.isError).toBe(true);
    expect(textOf(r)).toEqual({
      ok: false,
      code: "COOLDOWN",
      message: "Too soon.",
    });
  });

  it("turns a throw into the fixed sentence and logs the detail", async () => {
    const boom = new Error('duplicate key value violates "completions_pkey"');
    const d = deps(async () => {
      throw boom;
    });
    const r = await callMcpTool("whoami", {}, caller([READ]), undefined, d);
    expect(textOf(r)).toEqual({
      ok: false,
      code: "INTERNAL",
      message: MCP_GENERIC_ERROR,
    });
    expect(JSON.stringify(r)).not.toContain("duplicate key");
    expect(d.logError).toHaveBeenCalledWith("[mcp] tool whoami threw", boom);
  });
});

describe("auth info", () => {
  it("round-trips the caller through mcp-handler's AuthInfo", () => {
    const c = caller([READ]);
    const info = toAuthInfo("tok", c);
    expect(info).toEqual({
      token: "tok",
      clientId: "client-1",
      scopes: [READ],
      extra: { memberId: c.memberId },
    });
    expect(callerFromAuthInfo(info)).toEqual(c);
  });

  it("is null without a member", () => {
    expect(callerFromAuthInfo(undefined)).toBeNull();
    expect(
      callerFromAuthInfo({ token: "t", clientId: "c", scopes: [READ] }),
    ).toBeNull();
    expect(
      callerFromAuthInfo({
        token: "t",
        clientId: "c",
        scopes: [READ],
        extra: { memberId: "" },
      }),
    ).toBeNull();
  });
});

describe("ipFromHeaders", () => {
  it("takes the first forwarded address, then x-real-ip", () => {
    expect(ipFromHeaders({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })).toBe(
      "1.2.3.4",
    );
    expect(ipFromHeaders({ "x-forwarded-for": ["9.9.9.9"] })).toBe("9.9.9.9");
    expect(ipFromHeaders({ "x-real-ip": " 7.7.7.7 " })).toBe("7.7.7.7");
    expect(ipFromHeaders({})).toBe("unknown");
    expect(ipFromHeaders(undefined)).toBe("unknown");
  });
});
