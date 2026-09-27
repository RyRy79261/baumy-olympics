// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  AiIncompleteError,
  AiRefusalError,
  AiTimeoutError,
  AiTruncatedError,
} from "./claude-call";
import { aiFailure } from "./errors";

// Every way Claude fails maps to a status, a code the sheet can check and a
// sentence; nothing from the provider's error is passed on.

const apiError = (status: number) =>
  Anthropic.APIError.generate(
    status,
    { error: { type: "error", message: "secret upstream detail" } },
    "secret upstream detail",
    new Headers(),
  );

describe("aiFailure", () => {
  it.each([
    [new AiRefusalError("bio"), 422, "AI_REFUSED"],
    [new AiTruncatedError(), 502, "RESPONSE_TRUNCATED"],
    [new AiIncompleteError(), 502, "AI_INCOMPLETE"],
    [new AiTimeoutError(), 504, "AI_TIMEOUT"],
    [new Anthropic.APIConnectionTimeoutError(), 504, "AI_TIMEOUT"],
    [apiError(401), 502, "INVALID_KEY"],
    [apiError(403), 502, "INVALID_KEY"],
    [apiError(429), 503, "UNAVAILABLE"],
    [apiError(500), 503, "UNAVAILABLE"],
    [apiError(529), 503, "UNAVAILABLE"],
    [
      new Anthropic.APIConnectionError({ message: "reset" }),
      503,
      "UNAVAILABLE",
    ],
  ])("maps %s", (error, status, code) => {
    const mapped = aiFailure(error);
    expect(mapped).toMatchObject({ status, body: { ok: false, code } });
    expect(mapped!.body.message).not.toContain("secret");
    expect(mapped!.body.message.length).toBeGreaterThan(10);
  });

  it("leaves anything else to the route's generic answer", () => {
    expect(aiFailure(apiError(400))).toBeNull();
    expect(aiFailure(new Error("boom"))).toBeNull();
    expect(aiFailure("nope")).toBeNull();
  });
});
