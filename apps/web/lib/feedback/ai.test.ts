// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_MODELS, REPORT_TIER } from "@baumy/ai-prompts";
import {
  setClaudeClientForTests,
  type ClaudeClient,
  type CreateMessage,
} from "@/lib/integrations/claude";
import { reportAiAvailable, structureWithAi } from "./ai";

// Ported from camp-404 `apps/web/lib/__tests__/feedback-ai.test.ts`: any
// failure is null, so the caller files the plain report.

function returning(content: unknown[]): {
  client: ClaudeClient;
  create: ReturnType<typeof vi.fn<CreateMessage>>;
} {
  const create = vi.fn<CreateMessage>(async () => ({ content }) as never);
  return { client: { ok: true, kind: "anthropic", create }, create };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  setClaudeClientForTests(null);
});

describe("structureWithAi", () => {
  it("returns the report from the format tool, on the model ai-prompts names", async () => {
    const { client, create } = returning([
      {
        type: "tool_use",
        name: "format_report",
        input: { title: "T", summary: "S" },
      },
    ]);
    expect(await structureWithAi("bug", "it broke", client)).toEqual({
      title: "T",
      summary: "S",
    });
    const [params, options] = create.mock.calls[0]!;
    expect(params.model).toBe(CLAUDE_MODELS[REPORT_TIER]);
    expect(params.tool_choice).toEqual({ type: "tool", name: "format_report" });
    expect(options).toEqual({ timeout: 15_000, maxRetries: 0 });
  });

  it("drops a severity the model sends anyway", async () => {
    const { client } = returning([
      {
        type: "tool_use",
        name: "format_report",
        input: { title: "T", summary: "S", severity: "critical" },
      },
    ]);
    expect(await structureWithAi("bug", "it broke", client)).toEqual({
      title: "T",
      summary: "S",
    });
  });

  it("is null without a key, without the tool call, or with a bad shape", async () => {
    expect(
      await structureWithAi("bug", "x", {
        ok: false,
        reason: "not_configured",
      }),
    ).toBeNull();
    expect(
      await structureWithAi(
        "bug",
        "x",
        returning([{ type: "text", text: "hi" }]).client,
      ),
    ).toBeNull();
    expect(
      await structureWithAi(
        "bug",
        "x",
        returning([
          {
            type: "tool_use",
            name: "format_report",
            input: { summary: "no title" },
          },
        ]).client,
      ),
    ).toBeNull();
  });

  it("is null when the call throws, and logs the status only", async () => {
    const log = vi.mocked(console.error);
    const failing = (err: unknown): ClaudeClient => ({
      ok: true,
      kind: "anthropic",
      create: async () => {
        throw err;
      },
    });
    expect(
      await structureWithAi(
        "feature",
        "secret words",
        failing(Object.assign(new Error("secret words"), { status: 529 })),
      ),
    ).toBeNull();
    expect(log.mock.calls[0]![0]).toContain("529");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret words");
    expect(await structureWithAi("bug", "x", failing("boom"))).toBeNull();
    expect(log.mock.calls[1]![0]).toContain("no status");
  });
});

describe("reportAiAvailable", () => {
  it("follows the Claude client", () => {
    setClaudeClientForTests({ ok: false, reason: "not_configured" });
    expect(reportAiAvailable()).toBe(false);
    setClaudeClientForTests(returning([]).client);
    expect(reportAiAvailable()).toBe(true);
  });
});
