// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import {
  MCP_TOUCH_EVERY_MS,
  hashMcpSecret,
  insertMcpClient,
  insertMcpTokens,
} from "@baumy/db/mcp-oauth";
import { mcpAccessTokens } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { seedMember } from "@/test-utils/actions";
import { now } from "@/lib/clock";
import { bearerToken, mcpActor, verifyToken } from "./verify";

// verifyToken: every call looks the token up again, so revoking, expiry and
// deactivation take effect at once. It records use without failing on it.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

async function token(memberId: string) {
  await insertMcpClient(db(), {
    clientId: "c",
    clientSecretHash: null,
    clientName: "Claude",
    redirectUris: ["https://claude.ai/cb"],
    tokenEndpointAuthMethod: "none",
    now: now(),
  });
  await insertMcpTokens(db(), {
    grantId: "00000000-0000-4000-8000-000000000001",
    tokenHash: hashMcpSecret("baumy_at_x"),
    refreshTokenHash: hashMcpSecret("baumy_rt_x"),
    clientId: "c",
    memberId,
    scopes: ["baumy:read"],
    grantedAt: now(),
    now: now(),
  });
}

describe("verifyToken", () => {
  it("returns the member, scopes and client, and records the use", async () => {
    const m = await seedMember(db());
    await token(m);
    const info = await verifyToken("baumy_at_x", db());
    expect(info).toEqual({
      memberId: m,
      scopes: ["baumy:read"],
      clientId: "c",
    });
    const [row] = await t.db().select().from(mcpAccessTokens);
    expect(row!.lastUsedAt).not.toBeNull();
    expect(mcpActor(info!)).toEqual({
      kind: "mcp",
      memberId: m,
      scopes: ["baumy:read"],
    });
    expect(MCP_TOUCH_EVERY_MS).toBeGreaterThan(0);
  });

  it("refuses nothing, junk and an oversized token without a query", async () => {
    const spy = vi.fn();
    const fake = { select: spy } as unknown as Queryable;
    expect(await verifyToken(undefined, fake)).toBeNull();
    expect(await verifyToken("", fake)).toBeNull();
    expect(await verifyToken("x".repeat(257), fake)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(await verifyToken("baumy_at_unknown", db())).toBeNull();
  });

  it("still answers when recording the use fails", async () => {
    const m = await seedMember(db());
    await token(m);
    const real = db();
    const flaky = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "update") {
          return () => {
            throw new Error("db down");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyToken("baumy_at_x", flaky)).not.toBeNull();
    expect(log).toHaveBeenCalledWith(
      "[mcp] could not record last_used_at",
      expect.any(Error),
    );
    log.mockRestore();
  });
});

describe("bearerToken", () => {
  it("reads a Bearer header and nothing else", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
