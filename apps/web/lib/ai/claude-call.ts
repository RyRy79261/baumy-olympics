import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { CreateMessage, MessageParams } from "@/lib/integrations/claude";

// One logical Claude call for the Baumy command (SPEC §6.3), ported from
// intake-tracker `apps/web/src/app/api/ai/_shared/claude-call.ts`. It
// branches on `stop_reason` before anyone reads `content`:
//
//   - `refusal`    → AiRefusalError (mapped to a clear 422 in errors.ts);
//   - `max_tokens` → one retry with double the budget (up to a ceiling),
//                    then AiTruncatedError;
//   - `pause_turn` → resumed with the paused content, up to `maxResumes`
//                    times, then AiIncompleteError.
//
// Each upstream call's timeout is whatever is left of one deadline shared by
// the whole command, so a slow model cannot run the route past its limit and
// come back as a non-JSON 504. Retryable failures (429, 5xx, a dropped
// connection) are retried here, not by the SDK: the SDK would give a retry
// the same deadline-sized timeout as the attempt before it.
//
// Differences from intake-tracker: the SDK client is behind the `CreateMessage`
// adapter (lib/integrations/claude.ts, which also serves the e2e fake), usage
// is reported through `onUsage` (the route sums it into one `ai_usage` row
// per command), and time comes from the caller's clock.

/** The model declined the request (HTTP 200, `stop_reason: "refusal"`). */
export class AiRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`Model refused the request${category ? ` (${category})` : ""}`);
    this.name = "AiRefusalError";
  }
}

/** Output hit `max_tokens` even after the budget was raised. */
export class AiTruncatedError extends Error {
  constructor() {
    super("Model response was cut off at max_tokens");
    this.name = "AiTruncatedError";
  }
}

/** A paused turn was still paused after every allowed resume. */
export class AiIncompleteError extends Error {
  constructor() {
    super("Model turn was still paused after the resume limit");
    this.name = "AiIncompleteError";
  }
}

/** The command's deadline ran out before the next upstream call. */
export class AiTimeoutError extends Error {
  constructor() {
    super("AI request ran out of time");
    this.name = "AiTimeoutError";
  }
}

export interface CallOptions {
  /** Epoch ms by `nowMs`, shared by every upstream call of the command. */
  deadline: number;
  /** The clock the deadline is on. */
  nowMs: () => number;
  /** Called with each upstream response's usage, success or not. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  /** Retries per upstream call on a retryable error. Default 1. */
  maxRetries?: number;
  /** Largest `max_tokens` a truncated response may be retried with. */
  maxTokensCeiling?: number;
  /** How many times a `pause_turn` may be resumed. Default 2. */
  maxResumes?: number;
  /** Waits between retries; tests pass one that does not. */
  sleep?: (ms: number) => Promise<void>;
}

/** Do not start an upstream call with less than this left. */
export const MIN_ATTEMPT_MS = 2_000;
const DEFAULT_MAX_TOKENS_CEILING = 16_000;
const DEFAULT_MAX_RESUMES = 2;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The same failures the SDK's own retry policy retries. */
export function isRetryable(error: unknown): boolean {
  // A timed-out attempt already used up the deadline.
  if (error instanceof Anthropic.APIConnectionTimeoutError) return false;
  if (error instanceof Anthropic.APIUserAbortError) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (!(error instanceof Anthropic.APIError)) return false;
  const shouldRetry = error.headers?.get("x-should-retry");
  if (shouldRetry === "true") return true;
  if (shouldRetry === "false") return false;
  const status = error.status ?? 0;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Wait before retry number `attempt` (0-based): retry-after, else backoff. */
function retryDelayMs(error: unknown, attempt: number): number {
  const header =
    error instanceof Anthropic.APIError
      ? error.headers?.get("retry-after")
      : null;
  const seconds = header != null ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
}

/**
 * A `messages.create` plus whatever resumes and budget retries its
 * `stop_reason` calls for. The returned message's `content` spans every
 * resumed segment, so the caller can replay it as the assistant turn.
 */
export async function createMessage(
  create: CreateMessage,
  params: MessageParams,
  opts: CallOptions,
): Promise<Anthropic.Message> {
  const ceiling = Math.max(
    params.max_tokens,
    opts.maxTokensCeiling ?? DEFAULT_MAX_TOKENS_CEILING,
  );
  const maxResumes = opts.maxResumes ?? DEFAULT_MAX_RESUMES;
  const maxRetries = opts.maxRetries ?? 1;
  const sleep = opts.sleep ?? realSleep;

  let request = params;
  let paused: Anthropic.ContentBlock[] = [];
  let resumes = 0;
  let grewBudget = false;
  let retries = 0;

  for (;;) {
    const remaining = opts.deadline - opts.nowMs();
    if (remaining < MIN_ATTEMPT_MS) throw new AiTimeoutError();

    let message: Anthropic.Message;
    try {
      message = await create(request, { timeout: remaining, maxRetries: 0 });
    } catch (error) {
      if (retries < maxRetries && isRetryable(error)) {
        const delay = retryDelayMs(error, retries);
        // Only retry while a worthwhile attempt still fits after the wait.
        if (opts.deadline - opts.nowMs() - delay >= MIN_ATTEMPT_MS) {
          retries++;
          if (delay > 0) await sleep(delay);
          continue;
        }
      }
      throw error;
    }
    retries = 0;
    opts.onUsage?.({
      inputTokens:
        (message.usage?.input_tokens ?? 0) +
        (message.usage?.cache_creation_input_tokens ?? 0) +
        (message.usage?.cache_read_input_tokens ?? 0),
      outputTokens: message.usage?.output_tokens ?? 0,
    });

    switch (message.stop_reason) {
      case "refusal":
        throw new AiRefusalError(message.stop_details?.category ?? null);

      case "max_tokens":
        if (!grewBudget && request.max_tokens < ceiling) {
          grewBudget = true;
          request = {
            ...request,
            max_tokens: Math.min(ceiling, request.max_tokens * 2),
          };
          continue;
        }
        throw new AiTruncatedError();

      case "pause_turn":
        if (resumes >= maxResumes) throw new AiIncompleteError();
        resumes++;
        // Resume by sending the paused content back as the assistant turn.
        // The turn grows append-only, which keeps replayed thinking valid.
        paused = [...paused, ...message.content];
        request = {
          ...request,
          messages: [
            ...params.messages,
            { role: "assistant", content: paused },
          ],
        };
        continue;

      default:
        return paused.length > 0
          ? { ...message, content: [...paused, ...message.content] }
          : message;
    }
  }
}
