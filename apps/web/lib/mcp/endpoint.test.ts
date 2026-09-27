// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { createMcpEndpoint, type McpEndpointDeps } from "./endpoint";
import { MCP_NOT_CONFIGURED } from "./origin";
import type { McpCaller } from "./tools";

// The MCP endpoint end to end in-process (issue #24): real mcp-handler, real
// Streamable HTTP transport and the real registry tool list; the token check
// and runAction are fakes. JSON-RPC goes in, and the answer comes back as
// one SSE event.

const URL_ = "http://localhost:3000/api/mcp/mcp";
const MEMBER = "22222222-2222-4222-8222-222222222222";

const TOKENS: Record<string, McpCaller> = {
  reader: { memberId: MEMBER, scopes: ["baumy:read"], clientId: "c1" },
  writer: {
    memberId: MEMBER,
    scopes: ["baumy:read", "baumy:write"],
    clientId: "c2",
  },
};

function setup(env: Record<string, string | undefined> = {}) {
  const runAction = vi.fn(async (name: string) => ({
    ok: true as const,
    data: { ran: name },
  }));
  const deps: McpEndpointDeps = {
    env,
    verifyToken: vi.fn(async (t) => (t ? (TOKENS[t] ?? null) : null)),
    tools: {
      specs: () => toolSpecs("mcp"),
      runAction,
      householdId: "house-1",
      now: () => new Date("2026-09-27T10:00:00.000Z"),
      newRequestId: () => "req-1",
      logError: vi.fn(),
    },
  };
  return { handle: createMcpEndpoint(deps), runAction, deps };
}

let id = 0;
function rpc(
  method: string,
  params: Record<string, unknown> = {},
  token?: string,
  url = URL_,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-forwarded-for": "198.51.100.7",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
}

async function result(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(200);
  const text = await res.text();
  const data = text
    .split("\n")
    .find((l) => l.startsWith("data: "))
    ?.slice("data: ".length);
  const msg = JSON.parse(data ?? text) as {
    result?: Record<string, unknown>;
    error?: unknown;
  };
  expect(msg.error).toBeUndefined();
  return msg.result!;
}

const toolNames = async (res: Response) =>
  ((await result(res)).tools as { name: string }[]).map((t) => t.name);

describe("the MCP endpoint", () => {
  it("initializes as baumy with the tools capability", async () => {
    const { handle } = setup();
    const res = await handle(
      rpc(
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
        "reader",
      ),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const init = await result(res);
    expect(init.serverInfo).toEqual({ name: "baumy", version: "1.0.0" });
    expect(init.capabilities).toMatchObject({ tools: {} });
  });

  it("lists reads but no writes for a read-only token", async () => {
    const { handle } = setup();
    const names = await toolNames(
      await handle(rpc("tools/list", {}, "reader")),
    );
    expect(names).toContain("get_standings");
    expect(names).not.toContain("log_completion");
  });

  it("lists the writes too for a token with baumy:write", async () => {
    const { handle } = setup();
    const res = await handle(rpc("tools/list", {}, "writer"));
    const tools = (await result(res)).tools as {
      name: string;
      inputSchema: { type: string };
    }[];
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_standings");
    expect(names).toContain("log_completion");
    expect(names).not.toContain("delete_note");
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("runs get_standings as the token's member from the mcp surface", async () => {
    const { handle, runAction } = setup();
    const res = await handle(
      rpc("tools/call", { name: "get_standings", arguments: {} }, "reader"),
    );
    const out = await result(res);
    expect(out.isError).toBeUndefined();
    expect(out.content).toEqual([
      { type: "text", text: JSON.stringify({ ran: "get_standings" }) },
    ]);
    expect(runAction).toHaveBeenCalledWith(
      "get_standings",
      {},
      expect.objectContaining({
        source: "mcp",
        actor: { kind: "mcp", memberId: MEMBER, scopes: ["baumy:read"] },
        ip: "198.51.100.7",
      }),
    );
  });

  it("refuses log_completion to a read-only token without running it", async () => {
    const { handle, runAction } = setup();
    const out = await result(
      await handle(
        rpc(
          "tools/call",
          { name: "log_completion", arguments: { choreId: "x" } },
          "reader",
        ),
      ),
    );
    expect(out.isError).toBe(true);
    expect(runAction).not.toHaveBeenCalled();
  });

  it("answers 401 with the resource metadata hint to a bad or missing token", async () => {
    const { handle, runAction } = setup();
    for (const token of ["revoked", undefined]) {
      const res = await handle(rpc("tools/list", {}, token));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain(
        'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"',
      );
      expect(res.headers.get("access-control-expose-headers")).toBe(
        "WWW-Authenticate",
      );
    }
    expect(runAction).not.toHaveBeenCalled();
  });

  it("points the hint at MCP_PUBLIC_URL when it is set", async () => {
    const { handle } = setup({ MCP_PUBLIC_URL: "https://baumy.example.com" });
    const res = await handle(rpc("tools/list", {}, "nope"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://baumy.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it("fails closed with 503 on Vercel without MCP_PUBLIC_URL", async () => {
    const { handle, deps } = setup({ VERCEL_ENV: "production" });
    const res = await handle(rpc("tools/list", {}, "writer"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error_description: MCP_NOT_CONFIGURED,
    });
    expect(deps.verifyToken).not.toHaveBeenCalled();
  });
});
