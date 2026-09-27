// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@baumy/db/test-harness";
import { POST } from "./route";

// The test-only weights trigger: 404 outside test mode, a 400 for a bad
// body, and the two jobs at the server clock on PGlite.

useTestDb();

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/test/weights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/test/weights", () => {
  it("does not exist outside test mode", async () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    const res = await post({ run: "compute" });
    expect(res.status).toBe(404);
  });

  it("refuses a body it does not know", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    for (const body of ["not json", { run: "nope" }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
  });

  it("runs the compute and the apply", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    const computed = await post({ run: "compute" });
    expect(computed.status).toBe(200);
    expect(await computed.json()).toEqual({ measured: 0, suggested: 0 });
    const applied = await post({ run: "apply" });
    expect(await applied.json()).toEqual({ applied: 0 });
  });
});
