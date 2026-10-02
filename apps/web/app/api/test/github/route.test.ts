// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMemoryIssues,
  memoryGithub,
} from "@/lib/integrations/github-memory";
import { GET } from "./route";

// The fake tracker's window: 404 outside test mode, the filed issues in it.

afterEach(() => {
  vi.unstubAllEnvs();
  clearMemoryIssues();
});

describe("/api/test/github", () => {
  it("does not exist outside test mode", async () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    expect((await GET()).status).toBe(404);
  });

  it("lists what the fake tracker was sent", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    await memoryGithub({ title: "T", body: "B", labels: ["bug"] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issues: [{ number: 1, title: "T", body: "B", labels: ["bug"] }],
    });
  });
});
