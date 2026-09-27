import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  MCP_ACCESS_TOKEN_TTL_MS,
  MCP_AUTH_CODE_TTL_MS,
  MCP_REFRESH_TOKEN_TTL_MS,
  MCP_TOUCH_EVERY_MS,
  consumeMcpAuthCode,
  findLiveMcpAccessToken,
  findMcpClient,
  hashMcpSecret,
  insertMcpAuthCode,
  insertMcpClient,
  insertMcpTokens,
  listMcpConnections,
  mcpHashesEqual,
  revokeMcpGrant,
  revokeMcpToken,
  rotateMcpRefreshToken,
  touchMcpAccessToken,
} from "../mcp-oauth";
import { mcpAccessTokens, mcpAuthCodes, members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-09-27T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function member(name = "Ryan"): Promise<string> {
  const [m] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      displayName: name,
      avatarSprite: "cat",
      color: "#112233",
    })
    .returning({ id: members.id });
  return m!.id;
}

async function deactivate(id: string) {
  await t
    .db()
    .update(members)
    .set({ deactivatedAt: NOW })
    .where(eq(members.id, id));
}

async function client(clientId = "mcp_client_a", name = "Claude") {
  return insertMcpClient(db(), {
    clientId,
    clientSecretHash: null,
    clientName: name,
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    tokenEndpointAuthMethod: "none",
    now: NOW,
  });
}

let grantSeq = 0;
function grantId() {
  grantSeq += 1;
  return `00000000-0000-4000-8000-${String(grantSeq).padStart(12, "0")}`;
}

async function tokens(
  memberId: string,
  opts: {
    clientId?: string;
    access?: string;
    refresh?: string;
    grant?: string;
  } = {},
) {
  const grant = opts.grant ?? grantId();
  await insertMcpTokens(db(), {
    grantId: grant,
    tokenHash: hashMcpSecret(opts.access ?? "at-1"),
    refreshTokenHash: hashMcpSecret(opts.refresh ?? "rt-1"),
    clientId: opts.clientId ?? "mcp_client_a",
    memberId,
    scopes: ["baumy:read"],
    grantedAt: NOW,
    now: NOW,
  });
  return grant;
}

describe("hashing", () => {
  it("stores sha256 hex and compares in constant time", () => {
    const h = hashMcpSecret("secret");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMcpSecret("secret")).toBe(h);
    expect(mcpHashesEqual(h, hashMcpSecret("secret"))).toBe(true);
    expect(mcpHashesEqual(h, hashMcpSecret("other"))).toBe(false);
    expect(mcpHashesEqual(h, "short")).toBe(false);
  });
});

describe("clients", () => {
  it("registers and finds a client, and a confidential one needs a secret hash", async () => {
    const row = await client();
    expect(await findMcpClient(db(), "mcp_client_a")).toEqual(row);
    expect(await findMcpClient(db(), "nope")).toBeNull();
    await expect(
      insertMcpClient(db(), {
        clientId: "mcp_client_b",
        clientSecretHash: null,
        clientName: "X",
        redirectUris: [],
        tokenEndpointAuthMethod: "client_secret_post",
        now: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe("authorization codes", () => {
  async function code(memberId: string) {
    await client();
    const { expiresAt } = await insertMcpAuthCode(db(), {
      codeHash: hashMcpSecret("code-1"),
      clientId: "mcp_client_a",
      memberId,
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge",
      scopes: ["baumy:read"],
      now: NOW,
    });
    expect(expiresAt.getTime() - NOW.getTime()).toBe(MCP_AUTH_CODE_TTL_MS);
  }
  const use = (over: Partial<Parameters<typeof consumeMcpAuthCode>[1]> = {}) =>
    consumeMcpAuthCode(db(), {
      codeHash: hashMcpSecret("code-1"),
      clientId: "mcp_client_a",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      now: later(60_000),
      ...over,
    });

  it("stores only the hash and can be used once", async () => {
    const m = await member();
    await code(m);
    const rows = await t.db().select().from(mcpAuthCodes);
    expect(JSON.stringify(rows)).not.toContain("code-1");
    expect(await use()).toEqual({
      memberId: m,
      scopes: ["baumy:read"],
      codeChallenge: "challenge",
    });
    expect(await use()).toBeNull();
  });

  it("is not burned by a wrong client or redirect, and dies when it expires", async () => {
    await code(await member());
    expect(await use({ clientId: "other" })).toBeNull();
    expect(await use({ redirectUri: "https://claude.ai/x" })).toBeNull();
    expect(await use({ now: later(MCP_AUTH_CODE_TTL_MS) })).toBeNull();
    expect(await use()).not.toBeNull();
  });

  it("does nothing for a deactivated member", async () => {
    const m = await member();
    await code(m);
    await deactivate(m);
    expect(await use()).toBeNull();
  });
});

describe("tokens", () => {
  it("finds a live access token by hash, never the refresh token", async () => {
    const m = await member();
    await client();
    await tokens(m);
    const live = await findLiveMcpAccessToken(db(), hashMcpSecret("at-1"), NOW);
    expect(live).toMatchObject({
      clientId: "mcp_client_a",
      memberId: m,
      scopes: ["baumy:read"],
      lastUsedAt: null,
    });
    expect(live).not.toHaveProperty("tokenHash");
    expect(
      await findLiveMcpAccessToken(db(), hashMcpSecret("rt-1"), NOW),
    ).toBeNull();
    const rows = await t.db().select().from(mcpAccessTokens);
    expect(JSON.stringify(rows)).not.toMatch(/"(at|rt)-1"/);
  });

  it("stops an expired token and a deactivated member's token", async () => {
    const m = await member();
    await client();
    await tokens(m);
    const hash = hashMcpSecret("at-1");
    expect(
      await findLiveMcpAccessToken(
        db(),
        hash,
        later(MCP_ACCESS_TOKEN_TTL_MS - 1),
      ),
    ).not.toBeNull();
    expect(
      await findLiveMcpAccessToken(db(), hash, later(MCP_ACCESS_TOKEN_TTL_MS)),
    ).toBeNull();
    await deactivate(m);
    expect(await findLiveMcpAccessToken(db(), hash, NOW)).toBeNull();
  });

  it("touches last_used_at at most every 5 minutes", async () => {
    const m = await member();
    await client();
    await tokens(m);
    const hash = hashMcpSecret("at-1");
    const live = (await findLiveMcpAccessToken(db(), hash, NOW))!;
    await touchMcpAccessToken(db(), live, NOW);
    const touched = (await findLiveMcpAccessToken(db(), hash, NOW))!;
    expect(touched.lastUsedAt).toEqual(NOW);
    await touchMcpAccessToken(db(), touched, later(MCP_TOUCH_EVERY_MS - 1));
    expect((await findLiveMcpAccessToken(db(), hash, NOW))!.lastUsedAt).toEqual(
      NOW,
    );
  });

  it("rotates a refresh token once: the old pair dies, the new one keeps the grant", async () => {
    const m = await member();
    await client();
    const grant = await tokens(m);
    const rotate = (
      refresh: string,
      at: string,
      rt: string,
      now = later(1000),
    ) =>
      rotateMcpRefreshToken(db(), {
        refreshHash: hashMcpSecret(refresh),
        clientId: "mcp_client_a",
        tokenHash: hashMcpSecret(at),
        refreshTokenHash: hashMcpSecret(rt),
        now,
      });
    const out = await rotate("rt-1", "at-2", "rt-2");
    expect(out).toMatchObject({
      memberId: m,
      scopes: ["baumy:read"],
      grantId: grant,
    });
    expect(
      await findLiveMcpAccessToken(db(), hashMcpSecret("at-1"), later(2000)),
    ).toBeNull();
    expect(
      await findLiveMcpAccessToken(db(), hashMcpSecret("at-2"), later(2000)),
    ).not.toBeNull();
    // The old refresh token is spent.
    expect(await rotate("rt-1", "at-3", "rt-3")).toBeNull();
    // A lapsed one too.
    expect(
      await rotate(
        "rt-2",
        "at-4",
        "rt-4",
        later(MCP_REFRESH_TOKEN_TTL_MS + 1000),
      ),
    ).toBeNull();
  });

  it("refuses to rotate for another client or a deactivated member", async () => {
    const m = await member();
    await client();
    await tokens(m);
    const base = {
      refreshHash: hashMcpSecret("rt-1"),
      tokenHash: hashMcpSecret("at-2"),
      refreshTokenHash: hashMcpSecret("rt-2"),
      now: later(1000),
    };
    expect(
      await rotateMcpRefreshToken(db(), { ...base, clientId: "other" }),
    ).toBeNull();
    await deactivate(m);
    expect(
      await rotateMcpRefreshToken(db(), { ...base, clientId: "mcp_client_a" }),
    ).toBeNull();
  });

  it("revokes by access or refresh token, only for the presenting client", async () => {
    const m = await member();
    await client();
    await client("mcp_client_b", "Other");
    await tokens(m);
    await tokens(m, {
      clientId: "mcp_client_b",
      access: "at-b",
      refresh: "rt-b",
    });
    const revoke = (token: string, clientId = "mcp_client_a") =>
      revokeMcpToken(db(), {
        tokenHash: hashMcpSecret(token),
        clientId,
        now: NOW,
      });
    expect(await revoke("at-b")).toBe(0);
    expect(await revoke("rt-1")).toBe(1);
    expect(await revoke("at-1")).toBe(0);
    expect(
      await findLiveMcpAccessToken(db(), hashMcpSecret("at-1"), NOW),
    ).toBeNull();
    expect(await revoke("at-b", "mcp_client_b")).toBe(1);
  });
});

describe("connections", () => {
  it("lists the member's live grants and revokes only their own", async () => {
    const ryan = await member("Ryan");
    const sam = await member("Sam");
    await client();
    const mine = await tokens(ryan);
    const theirs = await tokens(sam, { access: "at-s", refresh: "rt-s" });
    await tokens(ryan, { access: "at-old", refresh: "rt-old" });
    await revokeMcpToken(db(), {
      tokenHash: hashMcpSecret("at-old"),
      clientId: "mcp_client_a",
      now: NOW,
    });

    expect(await listMcpConnections(db(), ryan, NOW)).toEqual([
      {
        grantId: mine,
        clientId: "mcp_client_a",
        clientName: "Claude",
        scopes: ["baumy:read"],
        grantedAt: NOW,
        lastUsedAt: null,
      },
    ]);
    expect(
      await listMcpConnections(db(), ryan, later(MCP_REFRESH_TOKEN_TTL_MS)),
    ).toEqual([]);

    expect(
      await revokeMcpGrant(db(), { memberId: ryan, grantId: theirs, now: NOW }),
    ).toBeNull();
    expect(
      await revokeMcpGrant(db(), { memberId: ryan, grantId: mine, now: NOW }),
    ).toEqual({ clientId: "mcp_client_a", clientName: "Claude" });
    expect(
      await revokeMcpGrant(db(), { memberId: ryan, grantId: mine, now: NOW }),
    ).toBeNull();
    expect(await listMcpConnections(db(), ryan, NOW)).toEqual([]);
    expect(await listMcpConnections(db(), sam, NOW)).toHaveLength(1);
  });
});
