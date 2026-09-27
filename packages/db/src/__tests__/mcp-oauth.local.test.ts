import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import {
  consumeMcpAuthCode,
  hashMcpSecret,
  insertMcpAuthCode,
  insertMcpClient,
  insertMcpTokens,
  rotateMcpRefreshToken,
} from "../mcp-oauth";
import * as schema from "../schema";

// A refresh token rotates once and a code is used once, even when a client
// retries at the same moment: each attempt is its own transaction on a real
// server, and exactly one compare-and-set may win the row.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const clientId = `local_${randomUUID()}`;
let memberId: string | undefined;

afterAll(async () => {
  const db = createHttpDb();
  // Codes and tokens go with the client (ON DELETE CASCADE).
  await db
    .delete(schema.mcpOauthClients)
    .where(eq(schema.mcpOauthClients.clientId, clientId));
  if (memberId) {
    await db
      .delete(schema.members)
      .where(inArray(schema.members.id, [memberId]));
  }
});

async function setup(): Promise<string> {
  if (memberId) return memberId;
  const db = createHttpDb() as unknown as Queryable;
  const [m] = await db
    .insert(schema.members)
    .values({
      householdId: HOUSEHOLD_ID,
      displayName: "Local MCP member",
      avatarSprite: "cat",
      color: "#112233",
    })
    .returning({ id: schema.members.id });
  memberId = m!.id;
  await insertMcpClient(db, {
    clientId,
    clientSecretHash: null,
    clientName: "Local",
    redirectUris: ["http://127.0.0.1/cb"],
    tokenEndpointAuthMethod: "none",
    now: new Date(),
  });
  return memberId;
}

describe("MCP OAuth under concurrent requests", () => {
  it("rotates one refresh token exactly once", async () => {
    const member = await setup();
    const refresh = `rt-${randomUUID()}`;
    await insertMcpTokens(createHttpDb() as unknown as Queryable, {
      grantId: randomUUID(),
      tokenHash: hashMcpSecret(`at-${randomUUID()}`),
      refreshTokenHash: hashMcpSecret(refresh),
      clientId,
      memberId: member,
      scopes: ["baumy:read"],
      grantedAt: new Date(),
      now: new Date(),
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        withTransaction((tx) =>
          rotateMcpRefreshToken(tx as unknown as Queryable, {
            refreshHash: hashMcpSecret(refresh),
            clientId,
            tokenHash: hashMcpSecret(`at-${randomUUID()}`),
            refreshTokenHash: hashMcpSecret(`rt-${randomUUID()}`),
            now: new Date(),
          }),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("uses one code exactly once", async () => {
    const member = await setup();
    const code = `ac-${randomUUID()}`;
    const db = createHttpDb() as unknown as Queryable;
    await insertMcpAuthCode(db, {
      codeHash: hashMcpSecret(code),
      clientId,
      memberId: member,
      redirectUri: "http://127.0.0.1/cb",
      codeChallenge: "c",
      scopes: ["baumy:read"],
      now: new Date(),
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        withTransaction((tx) =>
          consumeMcpAuthCode(tx as unknown as Queryable, {
            codeHash: hashMcpSecret(code),
            clientId,
            redirectUri: "http://127.0.0.1/cb",
            now: new Date(),
          }),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
