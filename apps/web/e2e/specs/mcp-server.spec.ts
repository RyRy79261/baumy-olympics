import { expect, test } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";
import { callTool, connect, mcpPost, mcpRpc, toolNames } from "../lib/mcp";

// Issue #24 end to end, against Docker Postgres: the scripted client of
// mcp-oauth.spec.ts connects through the real OAuth flow, then speaks MCP to
// /api/mcp/mcp the way claude.ai's custom connector does: initialize, list
// the tools, run a read and a write. A read-only connection never sees the
// writes, and a revoked token gets a 401 that points at our metadata.

const unique = (label: string) =>
  `${label} ${Math.random().toString(36).slice(2, 8)}`;

test("a connected client lists the tools, reads the standings and logs a chore", async ({
  page,
  request,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  const chore = unique("MCP chore");
  await addChore(page, { name: chore, basePoints: 20, cooldownHours: 48 });
  const { tokens } = await connect(page, request, unique("E2E Claude"), {
    write: true,
  });
  const token = tokens.access_token;

  const init = await mcpRpc<{ serverInfo: { name: string } }>(
    request,
    token,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    },
  );
  expect(init.serverInfo.name).toBe("baumy");

  const names = await toolNames(request, token);
  expect(names).toContain("get_standings");
  expect(names).toContain("log_completion");
  expect(names).not.toContain("delete_note");
  expect(names).not.toContain("manage_chore");

  const standings = await callTool(request, token, "get_standings");
  expect(standings.result.isError).toBeUndefined();

  const me = await callTool<{ memberId: string }>(request, token, "whoami");
  const { json: board } = await callTool<{
    chores: { id: string; name: string }[];
  }>(request, token, "list_chores");
  const choreId = board.chores.find((c) => c.name === chore)!.id;

  const logged = await callTool<{
    choreName: string;
    doneBy: string;
    totalPts: number;
  }>(request, token, "log_completion", { choreId });
  expect(logged.result.isError).toBeUndefined();
  expect(logged.json).toMatchObject({
    choreName: chore,
    doneBy: me.json.memberId,
    totalPts: 20,
  });

  // A second log inside the cooldown comes back as the action's own
  // sentence, not a stack trace.
  const again = await callTool<{ code: string; message: string }>(
    request,
    token,
    "log_completion",
    { choreId },
  );
  expect(again.result.isError).toBe(true);
  expect(again.json.code).toBe("COOLDOWN");
  expect(again.json.message).toContain("was done recently");

  // The member sees it on the chores page like any other log.
  await page.goto("/chores");
  await expect(page.getByTestId(`chore-${chore}`)).toContainText("streak 1");
});

test("a read-only connection sees no write tools, and a revoked token gets a 401", async ({
  page,
  request,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  const { meta, clientId, tokens } = await connect(
    page,
    request,
    unique("E2E Reader"),
    { write: false },
  );
  const token = tokens.access_token;
  expect(tokens.scope).toBe("baumy:read");

  const names = await toolNames(request, token);
  expect(names).toContain("get_standings");
  expect(names).not.toContain("log_completion");
  const refused = await callTool<{ code: string }>(
    request,
    token,
    "log_completion",
    { choreId: "00000000-0000-4000-8000-000000000000" },
  );
  expect(refused.result.isError).toBe(true);
  expect(refused.json.code).toBe("UNKNOWN_ACTION");

  const revoke = await request.post(meta.revocation_endpoint, {
    form: { token, client_id: clientId },
  });
  expect(revoke.status()).toBe(200);
  const dead = await mcpPost(request, token, "tools/list");
  expect(dead.status()).toBe(401);
  expect(dead.headers()["www-authenticate"]).toContain(
    "/.well-known/oauth-protected-resource",
  );

  // No token at all is the same 401.
  const anonymous = await request.post("/api/mcp/mcp", {
    headers: { accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect(anonymous.status()).toBe(401);
});
