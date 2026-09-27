// The scripted MCP client the MCP specs share (issues #23 and #24): it plays
// claude.ai's part, discovering the authorization server, registering with
// Dynamic Client Registration, sending the member through the consent page,
// exchanging the code with PKCE S256, then speaking JSON-RPC to /api/mcp/mcp.

import { createHash, randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

// A loopback redirect, as Claude Desktop and Claude Code use. Nothing listens
// there: the browser's navigation to it is caught by page.route.
export const REDIRECT = "http://127.0.0.1:47823/callback";

export interface Meta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  scopes_supported: string[];
  code_challenge_methods_supported: string[];
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
}

export async function discover(request: APIRequestContext): Promise<Meta> {
  const res = await request.get("/.well-known/oauth-authorization-server");
  expect(res.status()).toBe(200);
  const meta = (await res.json()) as Meta;
  expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  expect(meta.scopes_supported).toEqual(["baumy:read", "baumy:write"]);
  const resource = await request.get("/.well-known/oauth-protected-resource");
  expect((await resource.json()).authorization_servers).toEqual([meta.issuer]);
  return meta;
}

export async function register(
  request: APIRequestContext,
  meta: Meta,
  name: string,
): Promise<string> {
  const res = await request.post(meta.registration_endpoint, {
    data: { client_name: name, redirect_uris: [REDIRECT] },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(meta: Meta, clientId: string, challenge: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "e2e-state",
    scope: "baumy:read baumy:write",
  });
  return `${meta.authorization_endpoint}?${q}`;
}

/** Catch the navigation back to the client and hand over its query. */
export function catchCallback(page: Page): Promise<URL> {
  return new Promise((resolve) => {
    void page.route(`${REDIRECT}**`, async (route) => {
      resolve(new URL(route.request().url()));
      await route.fulfill({ status: 200, body: "connected" });
    });
  });
}

export async function exchange(
  request: APIRequestContext,
  meta: Meta,
  clientId: string,
  code: string,
  verifier: string,
): Promise<Tokens> {
  const res = await request.post(meta.token_endpoint, {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  return (await res.json()) as Tokens;
}

export async function verify(request: APIRequestContext, token: string) {
  return request.get("/api/test/mcp-token", {
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Connect a client for the member signed in on `page`: register, approve on
 * the consent page (ticking baumy:write when `write`), exchange the code.
 */
export async function connect(
  page: Page,
  request: APIRequestContext,
  name: string,
  { write }: { write: boolean },
): Promise<{ meta: Meta; clientId: string; tokens: Tokens }> {
  const meta = await discover(request);
  const clientId = await register(request, meta, name);
  const { verifier, challenge } = pkce();
  const callback = catchCallback(page);
  await page.goto(authorizeUrl(meta, clientId, challenge));
  if (write) await page.getByLabel("Make changes as you (baumy:write)").check();
  await page.getByRole("button", { name: "Approve" }).click();
  const code = (await callback).searchParams.get("code")!;
  const tokens = await exchange(request, meta, clientId, code, verifier);
  return { meta, clientId, tokens };
}

/** The connector URL: mcp-handler's `<basePath>/mcp` (intake gotcha #7). */
export const MCP_URL = "/api/mcp/mcp";

let rpcId = 0;

/** One JSON-RPC request to the MCP endpoint; the raw response. */
export function mcpPost(
  request: APIRequestContext,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  return request.post(MCP_URL, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    data: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
}

/** One JSON-RPC request that must succeed; its `result`. */
export async function mcpRpc<T = Record<string, unknown>>(
  request: APIRequestContext,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res = await mcpPost(request, token, method, params);
  expect(res.status()).toBe(200);
  const body = await res.text();
  // Streamable HTTP answers a POST with one SSE event.
  const data = body
    .split("\n")
    .find((l) => l.startsWith("data: "))
    ?.slice("data: ".length);
  const msg = JSON.parse(data ?? body) as { result?: T; error?: unknown };
  expect(msg.error).toBeUndefined();
  return msg.result!;
}

export interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

/** Call a tool; its result and the JSON inside its text. */
export async function callTool<T = unknown>(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ result: ToolResult; json: T }> {
  const result = await mcpRpc<ToolResult>(request, token, "tools/call", {
    name,
    arguments: args,
  });
  return { result, json: JSON.parse(result.content[0]!.text) as T };
}

/** The names of the tools the token sees. */
export async function toolNames(
  request: APIRequestContext,
  token: string,
): Promise<string[]> {
  const { tools } = await mcpRpc<{ tools: { name: string }[] }>(
    request,
    token,
    "tools/list",
  );
  return tools.map((t) => t.name);
}
