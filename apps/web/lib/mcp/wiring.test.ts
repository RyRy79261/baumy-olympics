// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@baumy/db/test-harness";
import { mcpOauthClients } from "@baumy/db/schema";

// The real dependencies of the MCP OAuth routes: the session's UI context,
// the real registry and the shared rate limiter.

const uiRequestCtx = vi.fn(async () => null);
vi.mock("@/lib/actions/ui", () => ({ uiRequestCtx }));

const { mcpRouteDeps } = await import("./wiring");

useTestDb();

describe("MCP route wiring", () => {
  it("uses the session's UI context and the real registry", async () => {
    const deps = mcpRouteDeps();
    expect(deps.env).toBe(process.env);
    await deps.requestCtx("req-1");
    expect(uiRequestCtx).toHaveBeenCalledWith("req-1");
    const res = await deps.runAction(
      "authorize_mcp_client",
      {},
      {
        actor: { kind: "kiosk", deviceId: "d" },
        source: "mcp",
        householdId: "h",
        now: new Date(),
      },
    );
    expect(res).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    await expect(deps.db().select().from(mcpOauthClients)).resolves.toEqual([]);
    await expect(deps.withTransaction(async () => 7)).resolves.toBe(7);
    await expect(
      deps.rateLimiter.limit("mcp:test", { limit: 1, windowMs: 1000 }),
    ).resolves.toMatchObject({ ok: true });
  });
});
