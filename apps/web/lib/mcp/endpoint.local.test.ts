import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHttpDb, isLocalProxy, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import {
  hashMcpSecret,
  insertMcpClient,
  insertMcpTokens,
  revokeMcpToken,
} from "@baumy/db/mcp-oauth";
import {
  actionRequests,
  auditEvents,
  choreRuleVersions,
  chores,
  completionScores,
  completions,
  mcpOauthClients,
  members,
} from "@baumy/db/schema";
import { REGISTRY } from "@/lib/actions/registry";
import { createRunner, defaultDeps } from "@/lib/actions/run";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { now } from "@/lib/clock";
import { FIXED_NOW, allowAll, seedMember } from "@/test-utils/actions";
import { createMcpEndpoint } from "./endpoint";
import { verifyToken } from "./verify";

// Issue #24 on real Postgres (Docker, the db-local lane): a token minted for
// a member, checked by the real verifyToken, runs the real registry through
// the MCP endpoint. log_completion stores a completion and an audit row with
// `source = mcp`; revoking the token turns the next request into a 401.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const db = () => createHttpDb() as unknown as Queryable;
const run = createRunner(REGISTRY, { ...defaultDeps, rateLimiter: allowAll });

const handle = createMcpEndpoint({
  env: {},
  verifyToken: (token) => verifyToken(token),
  tools: {
    specs: () => toolSpecs("mcp"),
    runAction: (name, input, ctx) => run(name, input, ctx),
    householdId: HOUSEHOLD_ID,
    now: () => FIXED_NOW,
    newRequestId: randomUUID,
    logError: (m, e) => console.error(m, e),
  },
});

const memberIds: string[] = [];
const choreIds: string[] = [];
const clientIds: string[] = [];

afterAll(async () => {
  if (choreIds.length > 0) {
    const ids = db()
      .select({ id: completions.id })
      .from(completions)
      .where(inArray(completions.choreId, choreIds));
    await db()
      .delete(completionScores)
      .where(inArray(completionScores.completionId, ids));
    await db()
      .delete(completions)
      .where(inArray(completions.choreId, choreIds));
    await db()
      .delete(choreRuleVersions)
      .where(inArray(choreRuleVersions.choreId, choreIds));
    await db().delete(chores).where(inArray(chores.id, choreIds));
  }
  if (clientIds.length > 0) {
    // Codes and tokens cascade with their client.
    await db()
      .delete(mcpOauthClients)
      .where(inArray(mcpOauthClients.clientId, clientIds));
  }
  if (memberIds.length > 0) {
    await db()
      .delete(auditEvents)
      .where(inArray(auditEvents.actorMemberId, memberIds));
    await db()
      .delete(actionRequests)
      .where(inArray(actionRequests.actorMemberId, memberIds));
    await db().delete(members).where(inArray(members.id, memberIds));
  }
});

/** A registered client and a live token pair for `memberId`. */
async function mint(memberId: string, scopes: string[]) {
  const clientId = `local_${randomUUID()}`;
  clientIds.push(clientId);
  const at = now();
  await insertMcpClient(db(), {
    clientId,
    clientSecretHash: null,
    clientName: "Local test client",
    redirectUris: ["http://127.0.0.1:1/cb"],
    tokenEndpointAuthMethod: "none",
    now: at,
  });
  const token = `baumy_at_${randomUUID()}`;
  await insertMcpTokens(db(), {
    grantId: randomUUID(),
    tokenHash: hashMcpSecret(token),
    refreshTokenHash: hashMcpSecret(`baumy_rt_${randomUUID()}`),
    clientId,
    memberId,
    scopes,
    grantedAt: at,
    now: at,
  });
  return { clientId, token };
}

let id = 0;
async function rpc(token: string, method: string, params: object = {}) {
  const res = await handle(
    new Request("http://localhost:3000/api/mcp/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
  );
  if (res.status !== 200) return { status: res.status, result: undefined };
  const line = (await res.text())
    .split("\n")
    .find((l) => l.startsWith("data: "))!;
  const msg = JSON.parse(line.slice(6)) as { result: Record<string, unknown> };
  return { status: res.status, result: msg.result };
}

const toolText = (result: Record<string, unknown> | undefined) =>
  JSON.parse((result!.content as { text: string }[])[0]!.text) as Record<
    string,
    unknown
  >;

describe("the MCP endpoint on Postgres", () => {
  it("logs a completion as the token's member, audited with source=mcp", async () => {
    const memberId = await seedMember(db(), {
      authUserId: `local_${randomUUID()}`,
    });
    memberIds.push(memberId);
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      name: `MCP ${randomUUID().slice(0, 8)}`,
    });
    choreIds.push(choreId);
    const { token } = await mint(memberId, ["baumy:read", "baumy:write"]);

    const listed = await rpc(token, "tools/list");
    const names = (listed.result!.tools as { name: string }[]).map(
      (t) => t.name,
    );
    expect(names).toContain("log_completion");

    const standings = await rpc(token, "tools/call", {
      name: "get_standings",
      arguments: {},
    });
    expect(standings.result!.isError).toBeUndefined();

    const logged = await rpc(token, "tools/call", {
      name: "log_completion",
      arguments: { choreId },
    });
    expect(logged.result!.isError).toBeUndefined();
    const data = toolText(logged.result);

    const stored = await db()
      .select({
        id: completions.id,
        source: completions.source,
        doneBy: completions.doneBy,
      })
      .from(completions)
      .where(eq(completions.choreId, choreId));
    expect(stored).toEqual([
      { id: data.completionId, source: "mcp", doneBy: memberId },
    ]);

    const audits = await db()
      .select({ source: auditEvents.source, action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorMemberId, memberId),
          eq(auditEvents.entityId, stored[0]!.id),
        ),
      );
    expect(audits).toEqual([{ source: "mcp", action: "log_completion" }]);
    const ledger = await db()
      .select({ source: actionRequests.source, status: actionRequests.status })
      .from(actionRequests)
      .where(eq(actionRequests.actorMemberId, memberId));
    expect(ledger).toEqual([{ source: "mcp", status: "done" }]);
  });

  it("does not list or run writes for a read-only token", async () => {
    const memberId = await seedMember(db(), {
      authUserId: `local_${randomUUID()}`,
    });
    memberIds.push(memberId);
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      name: `MCP RO ${randomUUID().slice(0, 8)}`,
    });
    choreIds.push(choreId);
    const { token } = await mint(memberId, ["baumy:read"]);

    const names = (
      (await rpc(token, "tools/list")).result!.tools as { name: string }[]
    ).map((t) => t.name);
    expect(names).toContain("get_standings");
    expect(names).not.toContain("log_completion");

    const refused = await rpc(token, "tools/call", {
      name: "log_completion",
      arguments: { choreId },
    });
    expect(refused.result!.isError).toBe(true);
    const stored = await db()
      .select({ id: completions.id })
      .from(completions)
      .where(eq(completions.choreId, choreId));
    expect(stored).toEqual([]);
  });

  it("answers 401 once the token is revoked", async () => {
    const memberId = await seedMember(db(), {
      authUserId: `local_${randomUUID()}`,
    });
    memberIds.push(memberId);
    const { clientId, token } = await mint(memberId, ["baumy:read"]);

    expect((await rpc(token, "tools/list")).status).toBe(200);
    await revokeMcpToken(db(), {
      tokenHash: hashMcpSecret(token),
      clientId,
      now: now(),
    });
    expect((await rpc(token, "tools/list")).status).toBe(401);
  });
});
