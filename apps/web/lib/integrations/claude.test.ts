// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeClient,
  setClaudeClientForTests,
  type ClaudeClient,
} from "./claude";
import { fakeClaude } from "./claude-fake";

// Which Claude an environment gets (SPEC §10): the fake in E2E test mode,
// the API with a key, and `not_configured` without one: fail closed.

afterEach(() => setClaudeClientForTests(null));

describe("claudeClient", () => {
  it("is not configured without ANTHROPIC_API_KEY", () => {
    expect(claudeClient({})).toEqual({ ok: false, reason: "not_configured" });
    expect(claudeClient({ ANTHROPIC_API_KEY: "   " })).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  it("uses the scripted fake in E2E test mode, even with a key", () => {
    const c = claudeClient({ E2E_TEST_MODE: "1", ANTHROPIC_API_KEY: "sk-x" });
    expect(c).toEqual({ ok: true, kind: "fake", create: fakeClaude });
  });

  it("talks to Anthropic with a key, reusing one SDK client per key", () => {
    const a = claudeClient({ ANTHROPIC_API_KEY: "sk-ant-test-1" });
    const b = claudeClient({ ANTHROPIC_API_KEY: "sk-ant-test-1" });
    expect(a).toMatchObject({ ok: true, kind: "anthropic" });
    expect(b).toMatchObject({ ok: true, kind: "anthropic" });
    expect(claudeClient({ ANTHROPIC_API_KEY: "sk-ant-test-2" })).toMatchObject({
      ok: true,
    });
  });

  it("answers with the test override until it is reset", () => {
    const fake: ClaudeClient = { ok: true, kind: "fake", create: fakeClaude };
    setClaudeClientForTests(fake);
    expect(claudeClient({})).toBe(fake);
    setClaudeClientForTests(null);
    expect(claudeClient({}).ok).toBe(false);
  });
});
