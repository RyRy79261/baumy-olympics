import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  AiIncompleteError,
  AiRefusalError,
  AiTimeoutError,
  AiTruncatedError,
} from "./claude-call";

// What the sheet is told when Claude fails (SPEC §6.3), ported from
// intake-tracker `apps/web/src/app/api/ai/_shared/ai-error-response.ts`.
// Every answer is `{ok: false, code, message}` like an action's, with a
// sentence the member can act on. Nothing from the provider's error body is
// passed on. Anything not recognised is null, and the route answers its own
// generic 502.
//
// Codes the sheet may check:
//   AI_REFUSED          Claude declined; asking again the same way won't help.
//   RESPONSE_TRUNCATED  the answer was cut off even after a retry.
//   AI_INCOMPLETE       a paused turn never finished.
//   AI_TIMEOUT          the command ran past its deadline.
//   INVALID_KEY         ANTHROPIC_API_KEY was refused (the owner must fix it).
//   UNAVAILABLE         Claude is overloaded or unreachable; try again.

export interface AiFailure {
  status: number;
  body: { ok: false; code: string; message: string };
}

const failure = (status: number, code: string, message: string): AiFailure => ({
  status,
  body: { ok: false, code, message },
});

export function aiFailure(error: unknown): AiFailure | null {
  if (error instanceof AiRefusalError) {
    return failure(
      422,
      "AI_REFUSED",
      "Baumy won't help with that one. Try asking another way, or do it in the app.",
    );
  }
  if (error instanceof AiTruncatedError) {
    return failure(
      502,
      "RESPONSE_TRUNCATED",
      "Baumy's answer got cut off. Try asking for less at once.",
    );
  }
  if (error instanceof AiIncompleteError) {
    return failure(502, "AI_INCOMPLETE", "Baumy didn't finish. Try again.");
  }
  if (
    error instanceof AiTimeoutError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return failure(504, "AI_TIMEOUT", "Baumy took too long. Try again.");
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return failure(
      502,
      "INVALID_KEY",
      "Baumy's connection to Claude was refused. An admin needs to check the ANTHROPIC_API_KEY setting.",
    );
  }
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return failure(
      503,
      "UNAVAILABLE",
      "Baumy can't think right now. Try again in a minute.",
    );
  }
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return failure(
      503,
      "UNAVAILABLE",
      "Baumy can't think right now. Try again in a minute.",
    );
  }
  return null;
}
