// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@baumy/db/test-harness";
import { GET } from "./route";

// The test-only token check: 404 outside test mode, 401 for a bad token.

useTestDb();

afterEach(() => {
  vi.unstubAllEnvs();
});

const get = (auth?: string) =>
  GET(
    new Request("http://localhost:3000/api/test/mcp-token", {
      headers: auth ? { authorization: auth } : {},
    }),
  );

describe("/api/test/mcp-token", () => {
  it("does not exist outside test mode", async () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    expect((await get("Bearer x")).status).toBe(404);
  });

  it("answers 401 for a token that does not verify", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    const res = await get("Bearer baumy_at_nope");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
    expect((await get()).status).toBe(401);
  });
});
