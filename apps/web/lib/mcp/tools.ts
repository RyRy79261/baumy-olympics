import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestCtx } from "@/lib/actions/define";
import type { ActionErrorCode, ActionResult } from "@/lib/actions/result";
import type { ToolSpec } from "@/lib/actions/tool-specs";
import { MCP_SCOPE } from "@/lib/auth/gates";
import { mcpActor, type McpTokenInfo } from "./verify";

// The MCP tools (SPEC §6.3, issue #24): the registry's `toolSpecs("mcp")`,
// filtered by the token's scopes, each call run through `runAction` as the
// token's member with `source: "mcp"`. Ported from intake-tracker
// `apps/web/src/lib/mcp/tools.ts`, but nothing here is hand-written per tool:
// the list, the schemas and the checks all come from the registry.
//
// - `baumy:read` lists the read tools, `baumy:write` the write tools. A tool
//   the token cannot see is refused exactly like one that does not exist.
// - Destructive actions never reach this file: `toolSpecs` drops them for
//   the `mcp` surface.
// - The client's own tool approval plus the member's `baumy:write` consent is
//   the human in the loop for writes (SPEC §9).
// - Results on error are generic: an action's code and its sentence (which
//   never holds SQL, a stack or a secret), or a fixed sentence when anything
//   threw. The detail goes to the server log only.

/** What `verifyToken` (verify.ts) says about the bearer of this request. */
export type McpCaller = McpTokenInfo;

export interface McpToolDeps {
  /** The registry's MCP tools, destructive ones already dropped. */
  specs: () => readonly ToolSpec[];
  runAction: (
    name: string,
    input: unknown,
    ctx: RequestCtx,
  ) => Promise<ActionResult<unknown>>;
  householdId: string;
  /** lib/clock.ts `now`, never `new Date()`. */
  now: () => Date;
  /**
   * A fresh idempotency key for one write call. MCP has no key of its own,
   * so a client retrying a call is a second call (SPEC §6.3 decision).
   */
  newRequestId: () => string;
  logError: (message: string, err: unknown) => void;
}

export const MCP_TOOL_UNAVAILABLE =
  "That tool is not available on this connection.";
export const MCP_GENERIC_ERROR = "Something went wrong. Please try again.";

/** The tools a token with `scopes` may list and call. */
export function toolsForScopes(
  specs: readonly ToolSpec[],
  scopes: readonly string[],
): ToolSpec[] {
  return specs.filter((s) => scopes.includes(MCP_SCOPE[s.kind]));
}

/** One registry tool as an MCP `Tool`. */
export function mcpTool(spec: ToolSpec): Tool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.input_schema as Tool["inputSchema"],
    annotations: {
      title: spec.title,
      readOnlyHint: spec.kind === "read",
      // Destructive actions are never listed, and nothing reaches outside.
      destructiveHint: false,
      openWorldHint: false,
    },
  };
}

function errorResult(body: {
  code: ActionErrorCode;
  message: string;
  [k: string]: unknown;
}): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, ...body }) }],
    isError: true,
  };
}

/**
 * An action's result as an MCP tool result. A failure keeps only the fields
 * meant for the person (code, sentence, field issues, when to retry); an
 * INTERNAL failure gets the fixed sentence whatever its message says.
 */
export function toCallToolResult(
  result: ActionResult<unknown>,
): CallToolResult {
  if (result.ok) {
    return {
      content: [{ type: "text", text: JSON.stringify(result.data ?? null) }],
    };
  }
  if (result.code === "INTERNAL") {
    return errorResult({ code: "INTERNAL", message: MCP_GENERIC_ERROR });
  }
  return errorResult({
    code: result.code,
    message: result.message,
    ...(result.issues ? { issues: result.issues } : {}),
    ...(result.retryAt ? { retryAt: result.retryAt } : {}),
    ...(result.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: result.retryAfterSeconds }
      : {}),
  });
}

/**
 * Run one tool call. Never throws: an unknown or unlisted tool, a missing
 * caller and an exception all come back as an `isError` result.
 */
export async function callMcpTool(
  name: string,
  args: unknown,
  caller: McpCaller | null,
  ip: string | undefined,
  deps: McpToolDeps,
): Promise<CallToolResult> {
  if (!caller) {
    return errorResult({
      code: "UNAUTHENTICATED",
      message: "This connection is not signed in. Reconnect it.",
    });
  }
  const spec = toolsForScopes(deps.specs(), caller.scopes).find(
    (s) => s.name === name,
  );
  if (!spec) {
    return errorResult({
      code: "UNKNOWN_ACTION",
      message: MCP_TOOL_UNAVAILABLE,
    });
  }
  try {
    const ctx: RequestCtx = {
      actor: mcpActor(caller),
      source: "mcp",
      householdId: deps.householdId,
      ...(spec.kind === "write" ? { requestId: deps.newRequestId() } : {}),
      ...(ip ? { ip } : {}),
      now: deps.now(),
    };
    return toCallToolResult(await deps.runAction(name, args ?? {}, ctx));
  } catch (err) {
    deps.logError(`[mcp] tool ${name} threw`, err);
    return errorResult({ code: "INTERNAL", message: MCP_GENERIC_ERROR });
  }
}

/** The `AuthInfo` mcp-handler carries for a verified token. */
export function toAuthInfo(token: string, caller: McpCaller): AuthInfo {
  return {
    token,
    clientId: caller.clientId,
    scopes: caller.scopes,
    extra: { memberId: caller.memberId },
  };
}

/** The caller back out of `AuthInfo`, or null when it is not ours. */
export function callerFromAuthInfo(
  info: AuthInfo | undefined,
): McpCaller | null {
  const memberId = info?.extra?.memberId;
  if (!info || typeof memberId !== "string" || memberId === "") return null;
  return { memberId, scopes: info.scopes, clientId: info.clientId };
}

type HeaderBag = Record<string, string | string[] | undefined>;

/** The client address from the forwarded headers, like getClientIp. */
export function ipFromHeaders(headers: HeaderBag | undefined): string {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const first = one(headers?.["x-forwarded-for"])?.split(",")[0]?.trim();
  if (first) return first;
  return one(headers?.["x-real-ip"])?.trim() || "unknown";
}

/**
 * Serve the registry on an MCP server: `tools/list` and `tools/call`, both
 * read from the request's own token, so one server instance never mixes two
 * callers' scopes.
 */
export function registerMcpTools(server: McpServer, deps: McpToolDeps): void {
  server.server.registerCapabilities({ tools: { listChanged: false } });
  server.server.setRequestHandler(ListToolsRequestSchema, (_req, extra) => {
    const caller = callerFromAuthInfo(extra.authInfo);
    const specs = caller ? toolsForScopes(deps.specs(), caller.scopes) : [];
    return { tools: specs.map(mcpTool) };
  });
  server.server.setRequestHandler(CallToolRequestSchema, (req, extra) =>
    callMcpTool(
      req.params.name,
      req.params.arguments,
      callerFromAuthInfo(extra.authInfo),
      ipFromHeaders(extra.requestInfo?.headers),
      deps,
    ),
  );
}
