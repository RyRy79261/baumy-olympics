// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@baumy/db/test-harness";
import { mcpOauthClients } from "@baumy/db/schema";

// The real dependencies of the MCP OAuth routes: the session's UI context,
// the real registry and the shared rate limiter.

const uiRequestCtx = vi.fn(async () => null);
vi.mock("@/lib/actions/ui", () => ({ uiRequestCtx }));

const { mcpEndpointDeps, mcpRouteDeps } = await import("./wiring");

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

describe("MCP endpoint wiring", () => {
  it("serves the registry's MCP tools and checks tokens against the database", async () => {
    const deps = mcpEndpointDeps();
    expect(deps.env).toBe(process.env);
    const names = deps.tools.specs().map((s) => s.name);
    expect(names).toContain("get_standings");
    expect(names).not.toContain("delete_note");
    expect(deps.tools.specs()).toBe(deps.tools.specs());
    await expect(deps.verifyToken("baumy_at_nope")).resolves.toBeNull();
    expect(deps.tools.newRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(deps.tools.now()).toBeInstanceOf(Date);
    const res = await deps.tools.runAction(
      "manage_chore",
      {},
      {
        actor: { kind: "mcp", memberId: "m", scopes: ["baumy:write"] },
        source: "mcp",
        householdId: deps.tools.householdId,
        now: new Date(),
      },
    );
    expect(res).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.tools.logError("[mcp] x", new Error("y"));
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
