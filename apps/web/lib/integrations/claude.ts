import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { isTestMode } from "@/lib/test-mode";
import { fakeClaude } from "./claude-fake";

// Which Claude this environment talks to (SPEC §6.3, §10): the scripted
// fake under E2E_TEST_MODE=1, the Anthropic API when ANTHROPIC_API_KEY is
// set, and otherwise `not_configured`, so the command answers "not connected
// yet" instead of failing. Only the one SDK call the command makes sits
// behind the adapter; the loop and the stop-reason handling
// (lib/ai/claude-call.ts) are the same for the real client and the fake.

export type MessageParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

export type CreateMessage = (
  params: MessageParams,
  options: { timeout: number; maxRetries: number },
) => Promise<Anthropic.Message>;

export type ClaudeClient =
  | { ok: true; kind: "anthropic" | "fake"; create: CreateMessage }
  | { ok: false; reason: "not_configured" };

type EnvBag = Readonly<Record<string, string | undefined>>;

let override: ClaudeClient | null = null;

/** Unit tests only: answer with this client until reset with null. */
export function setClaudeClientForTests(client: ClaudeClient | null): void {
  override = client;
}

let cached: { key: string; client: Anthropic } | null = null;

function sdkFor(key: string): Anthropic {
  if (cached?.key !== key) {
    // Retries and timeouts are ours (claude-call.ts), per call.
    cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 0 }) };
  }
  return cached.client;
}

export function claudeClient(env: EnvBag = process.env): ClaudeClient {
  if (override) return override;
  if (isTestMode(env)) return { ok: true, kind: "fake", create: fakeClaude };
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };
  const client = sdkFor(key);
  return {
    ok: true,
    kind: "anthropic",
    create: (params, options) => client.messages.create(params, options),
  };
}
