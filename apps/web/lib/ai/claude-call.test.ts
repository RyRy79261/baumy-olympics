// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageParams } from "@/lib/integrations/claude";
import {
  AiIncompleteError,
  AiRefusalError,
  AiTimeoutError,
  AiTruncatedError,
  MIN_ATTEMPT_MS,
  createMessage,
  isRetryable,
} from "./claude-call";

// The stop-reason-aware Claude call, ported with intake-tracker's tests
// (apps/web/src/app/api/ai/_shared/claude-call.test.ts). The SDK call is a
// stub; time is a fake clock, so nothing waits.

function apiError(status: number, headers: Record<string, string> = {}) {
  return Anthropic.APIError.generate(
    status,
    { error: { type: "error" } },
    "upstream",
    new Headers(headers),
  );
}

let clock = 0;
const nowMs = () => clock;
const create = vi.fn();
const sleep = vi.fn(async (ms: number) => {
  clock += ms;
});
const onUsage = vi.fn();

function opts(extra: Record<string, unknown> = {}) {
  return { deadline: clock + 50_000, nowMs, sleep, onUsage, ...extra };
}

function reply(
  stop_reason: string,
  content: unknown[] = [{ type: "text", text: "hi" }],
  extra: Record<string, unknown> = {},
) {
  return {
    content,
    stop_reason,
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: null,
    },
    ...extra,
  };
}

const toolUse = { type: "tool_use", id: "t1", name: "whoami", input: {} };

const params: MessageParams = {
  model: "claude-sonnet-5",
  max_tokens: 1000,
  messages: [{ role: "user", content: "hello" }],
};

beforeEach(() => {
  clock = 1_000_000;
  create.mockReset();
  sleep.mockClear();
  onUsage.mockReset();
});

describe("createMessage", () => {
  it("returns an end_turn reply and reports its usage", async () => {
    create.mockResolvedValueOnce(reply("end_turn"));
    const message = await createMessage(create, params, opts());
    expect(message.content).toEqual([{ type: "text", text: "hi" }]);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 15, outputTokens: 2 });
  });

  it("passes a timeout drawn from the deadline and turns off SDK retries", async () => {
    create.mockResolvedValueOnce(reply("end_turn"));
    await createMessage(create, params, opts({ deadline: clock + 30_000 }));
    expect(create.mock.calls[0]![1]).toEqual({
      timeout: 30_000,
      maxRetries: 0,
    });
  });

  it("works without a usage callback or a sleep", async () => {
    create.mockResolvedValueOnce({ ...reply("end_turn"), usage: undefined });
    const message = await createMessage(create, params, {
      deadline: clock + 50_000,
      nowMs,
    });
    expect(message.stop_reason).toBe("end_turn");
  });

  it("throws AiTimeoutError without calling Claude once the deadline is too close", async () => {
    await expect(
      createMessage(
        create,
        params,
        opts({ deadline: clock + MIN_ATTEMPT_MS - 1 }),
      ),
    ).rejects.toBeInstanceOf(AiTimeoutError);
    expect(create).not.toHaveBeenCalled();
  });

  it("turns a refusal into AiRefusalError with its category", async () => {
    create.mockResolvedValueOnce(
      reply("refusal", [], {
        stop_details: { type: "refusal", category: "cyber", explanation: null },
      }),
    );
    const error = await createMessage(create, params, opts()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AiRefusalError);
    expect((error as AiRefusalError).category).toBe("cyber");
    expect((error as AiRefusalError).message).toContain("(cyber)");
  });

  it("carries a null category when the refusal has none", async () => {
    create.mockResolvedValueOnce(reply("refusal", []));
    const error = await createMessage(create, params, opts()).catch(
      (e: unknown) => e,
    );
    expect((error as AiRefusalError).category).toBeNull();
  });

  it("retries a max_tokens reply once with double the budget", async () => {
    create
      .mockResolvedValueOnce(reply("max_tokens"))
      .mockResolvedValueOnce(reply("tool_use", [toolUse]));
    const message = await createMessage(create, params, opts());
    expect(create.mock.calls[1]![0].max_tokens).toBe(2000);
    expect(message.content).toEqual([toolUse]);
  });

  it("throws AiTruncatedError when the raised budget is cut off too", async () => {
    create.mockResolvedValue(reply("max_tokens"));
    await expect(createMessage(create, params, opts())).rejects.toBeInstanceOf(
      AiTruncatedError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not raise the budget past the ceiling", async () => {
    create.mockResolvedValue(reply("max_tokens"));
    await expect(
      createMessage(create, params, opts({ maxTokensCeiling: 1000 })),
    ).rejects.toBeInstanceOf(AiTruncatedError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("resumes a pause_turn with the paused content and returns the joined turn", async () => {
    const paused = { type: "text", text: "thinking about it" };
    create
      .mockResolvedValueOnce(reply("pause_turn", [paused]))
      .mockResolvedValueOnce(reply("tool_use", [toolUse]));
    const message = await createMessage(create, params, opts());
    expect(create.mock.calls[1]![0].messages).toEqual([
      ...params.messages,
      { role: "assistant", content: [paused] },
    ]);
    expect(message.content).toEqual([paused, toolUse]);
  });

  it("gives up with AiIncompleteError once the resume limit is spent", async () => {
    create.mockResolvedValue(reply("pause_turn"));
    await expect(
      createMessage(create, params, opts({ maxResumes: 1 })),
    ).rejects.toBeInstanceOf(AiIncompleteError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries a retryable error itself, after its retry-after", async () => {
    create
      .mockRejectedValueOnce(apiError(529, { "retry-after": "2" }))
      .mockResolvedValueOnce(reply("end_turn"));
    const message = await createMessage(create, params, opts());
    expect(message.stop_reason).toBe("end_turn");
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("backs off when the error has no retry-after", async () => {
    create
      .mockRejectedValueOnce(apiError(500))
      .mockResolvedValueOnce(reply("end_turn"));
    await createMessage(create, params, opts());
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("retries at once when retry-after is 0", async () => {
    create
      .mockRejectedValueOnce(apiError(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(reply("end_turn"));
    await createMessage(create, params, opts());
    expect(sleep).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error", async () => {
    const bad = apiError(400);
    create.mockRejectedValueOnce(bad);
    await expect(createMessage(create, params, opts())).rejects.toBe(bad);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the deadline has no room for another attempt", async () => {
    const slow = apiError(429, { "retry-after": "1" });
    create.mockRejectedValueOnce(slow);
    await expect(
      createMessage(create, params, opts({ deadline: clock + 2_500 })),
    ).rejects.toBe(slow);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("stops retrying after maxRetries", async () => {
    const error = apiError(503);
    create.mockRejectedValue(error);
    await expect(
      createMessage(create, params, opts({ maxRetries: 2 })),
    ).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(3);
  });
});

describe("isRetryable", () => {
  it("follows the SDK's own policy", () => {
    expect(isRetryable(apiError(408))).toBe(true);
    expect(isRetryable(apiError(409))).toBe(true);
    expect(isRetryable(apiError(429))).toBe(true);
    expect(isRetryable(apiError(500))).toBe(true);
    expect(isRetryable(apiError(400))).toBe(false);
    expect(isRetryable(apiError(401))).toBe(false);
    expect(isRetryable(apiError(400, { "x-should-retry": "true" }))).toBe(true);
    expect(isRetryable(apiError(500, { "x-should-retry": "false" }))).toBe(
      false,
    );
    expect(
      isRetryable(new Anthropic.APIConnectionError({ message: "reset" })),
    ).toBe(true);
    expect(isRetryable(new Anthropic.APIConnectionTimeoutError())).toBe(false);
    expect(isRetryable(new Anthropic.APIUserAbortError())).toBe(false);
    expect(isRetryable(new Error("boom"))).toBe(false);
  });
});
