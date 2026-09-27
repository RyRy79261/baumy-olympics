// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import {
  hashMcpSecret,
  insertMcpClient,
  insertMcpTokens,
} from "@baumy/db/mcp-oauth";
import {
  actionRequests,
  auditEvents,
  mcpAccessTokens,
  mcpAuthCodes,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { pkceChallenge } from "@/lib/mcp/tokens";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { runAction } from "./registry";

// The member's side of MCP OAuth (issue #23), through the real runAction on
// PGlite: approving a client, listing and disconnecting connections. All
// three need the member's own session, on the UI only.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CHALLENGE = pkceChallenge("x".repeat(43));

beforeEach(async () => {
  __resetMemoryRateLimits();
  await insertMcpClient(db(), {
    clientId: "client_a",
    clientSecretHash: null,
    clientName: "Claude",
    redirectUris: [REDIRECT],
    tokenEndpointAuthMethod: "none",
    now: FIXED_NOW,
  });
});

const approveInput = (over: Record<string, unknown> = {}) => ({
  clientId: "client_a",
  redirectUri: REDIRECT,
  codeChallenge: CHALLENGE,
  scopes: ["baumy:write", "baumy:read"],
  ...over,
});

function others(memberId: string): [Actor, string][] {
  return [
    [kioskActor(memberId), "kiosk"],
    [{ kind: "mcp", memberId, scopes: ["baumy:read", "baumy:write"] }, "mcp"],
    [{ kind: "service", tokenName: "baumy-brain", memberId }, "brain"],
    [sessionActor(undefined), "no member"],
  ];
}

describe("authorize_mcp_client", () => {
  it("mints a code for the ticked scopes, shown once and stored only as a hash", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const res = await runAction("authorize_mcp_client", approveInput(), ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.code).toMatch(/^baumy_ac_/);
    expect(res.data.scopes).toEqual(["baumy:read", "baumy:write"]);

    const [row] = await t.db().select().from(mcpAuthCodes);
    expect(row).toMatchObject({
      codeHash: hashMcpSecret(res.data.code!),
      clientId: "client_a",
      memberId: me,
      redirectUri: REDIRECT,
      codeChallenge: CHALLENGE,
      scopes: ["baumy:read", "baumy:write"],
    });
    const [ledger] = await t.db().select().from(actionRequests);
    expect(ledger!.result).toEqual({
      ok: true,
      data: { code: null, scopes: ["baumy:read", "baumy:write"] },
    });
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      entity: "mcp_client",
      entityId: "client_a",
      payload: { clientName: "Claude", scopes: ["baumy:read", "baumy:write"] },
    });

    // A replay gets no code.
    const replay = await runAction("authorize_mcp_client", approveInput(), ctx);
    expect(replay).toEqual({
      ok: true,
      data: { code: null, scopes: ["baumy:read", "baumy:write"] },
    });
  });

  it("refuses an unknown client, an unregistered redirect and no scopes", async () => {
    const me = await seedMember(db());
    const run = (over: Record<string, unknown>) =>
      runAction(
        "authorize_mcp_client",
        approveInput(over),
        ctxFor(sessionActor(me)),
      );
    expect(await run({ clientId: "nope" })).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await run({ redirectUri: "https://claude.ai/other" })).toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
    expect(await run({ scopes: [] })).toMatchObject({ code: "INVALID_INPUT" });
    expect(await run({ scopes: ["admin"] })).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await run({ codeChallenge: "short" })).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await t.db().select().from(mcpAuthCodes)).toEqual([]);
  });

  it("needs the member's own session", async () => {
    const me = await seedMember(db());
    for (const [actor, label] of others(me)) {
      const res = await runAction(
        "authorize_mcp_client",
        approveInput(),
        ctxFor(actor),
      );
      expect(res.ok, label).toBe(false);
    }
    const fromMcp = await runAction(
      "authorize_mcp_client",
      approveInput(),
      ctxFor(sessionActor(me), { source: "mcp" }),
    );
    expect(fromMcp).toMatchObject({ code: "SURFACE_FORBIDDEN" });
    expect(await t.db().select().from(mcpAuthCodes)).toEqual([]);
  });
});

async function grant(memberId: string, n: number, clientId = "client_a") {
  const grantId = `00000000-0000-4000-8000-00000000000${n}`;
  await insertMcpTokens(db(), {
    grantId,
    tokenHash: hashMcpSecret(`at-${n}`),
    refreshTokenHash: hashMcpSecret(`rt-${n}`),
    clientId,
    memberId,
    scopes: ["baumy:read"],
    grantedAt: FIXED_NOW,
    now: FIXED_NOW,
  });
  return grantId;
}

describe("list_mcp_connections and revoke_mcp_connection", () => {
  it("lists only my connections and disconnects one", async () => {
    const me = await seedMember(db());
    const them = await seedMember(db());
    const mine = await grant(me, 1);
    const theirs = await grant(them, 2);
    const ctx = () => ctxFor(sessionActor(me));

    expect(await runAction("list_mcp_connections", {}, ctx())).toEqual({
      ok: true,
      data: [
        {
          grantId: mine,
          clientName: "Claude",
          scopes: ["baumy:read"],
          grantedAt: FIXED_NOW.toISOString(),
          lastUsedAt: null,
        },
      ],
    });

    expect(
      await runAction("revoke_mcp_connection", { grantId: theirs }, ctx()),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      await runAction("revoke_mcp_connection", { grantId: mine }, ctx()),
    ).toEqual({ ok: true, data: { grantId: mine, clientName: "Claude" } });
    const [row] = await t
      .db()
      .select()
      .from(mcpAccessTokens)
      .where(eq(mcpAccessTokens.grantId, mine));
    expect(row!.revokedAt).toEqual(FIXED_NOW);
    const audit = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "revoke_mcp_connection"));
    expect(audit).toHaveLength(1);
    expect(await runAction("list_mcp_connections", {}, ctx())).toEqual({
      ok: true,
      data: [],
    });
    // Theirs is untouched.
    expect(
      await runAction("list_mcp_connections", {}, ctxFor(sessionActor(them))),
    ).toMatchObject({ ok: true, data: [{ grantId: theirs }] });
  });

  it("need the member's own session", async () => {
    const me = await seedMember(db());
    const mine = await grant(me, 1);
    for (const [actor, label] of others(me)) {
      expect(
        (await runAction("list_mcp_connections", {}, ctxFor(actor))).ok,
        label,
      ).toBe(false);
      expect(
        (
          await runAction(
            "revoke_mcp_connection",
            { grantId: mine },
            ctxFor(actor),
          )
        ).ok,
        label,
      ).toBe(false);
    }
    const [row] = await t.db().select().from(mcpAccessTokens);
    expect(row!.revokedAt).toBeNull();
  });
});
