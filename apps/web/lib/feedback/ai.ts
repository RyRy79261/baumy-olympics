import "server-only";

import { z } from "zod";
import {
  CLAUDE_MODELS,
  REPORT_FORMAT_TOOL,
  REPORT_SYSTEM_PROMPT,
  REPORT_TIER,
  reportUserMessage,
} from "@baumy/ai-prompts";
import type { ReportKind } from "@baumy/types";
import { claudeClient, type ClaudeClient } from "@/lib/integrations/claude";
import type { StructuredReport } from "./issue";

// The optional "Improve with AI" pass (issue #133), ported from camp-404
// `apps/web/lib/feedback-ai.ts`. Additive and fail-safe: no key, an API
// error, no tool call or a bad shape all return null, and the caller files
// the plain report. The caller passes ALREADY-REDACTED text, and the output
// is redacted again when the issue body is built (the model can echo PII).
// The model id comes from @baumy/ai-prompts, never inline.

/** The AI pass gives up after this, and the plain report is filed. */
export const REPORT_AI_TIMEOUT_MS = 15_000;

// No severity: zod's object strips one the model sends anyway.
const StructuredSchema = z.object({
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(2000),
  stepsToReproduce: z.array(z.string().max(500)).max(20).optional(),
  expected: z.string().max(1000).optional(),
  actual: z.string().max(1000).optional(),
});

/** Restructure the report, or null on any failure. */
export async function structureWithAi(
  kind: ReportKind,
  redactedText: string,
  client: ClaudeClient = claudeClient(),
): Promise<StructuredReport | null> {
  if (!client.ok) return null;
  try {
    const response = await client.create(
      {
        model: CLAUDE_MODELS[REPORT_TIER],
        max_tokens: 1024,
        temperature: 0,
        system: REPORT_SYSTEM_PROMPT,
        tools: [REPORT_FORMAT_TOOL],
        tool_choice: { type: "tool", name: REPORT_FORMAT_TOOL.name },
        messages: [
          { role: "user", content: reportUserMessage(kind, redactedText) },
        ],
      },
      { timeout: REPORT_AI_TIMEOUT_MS, maxRetries: 0 },
    );
    const block = response.content.find(
      (b) => b.type === "tool_use" && b.name === REPORT_FORMAT_TOOL.name,
    );
    if (!block || block.type !== "tool_use") return null;
    const parsed = StructuredSchema.safeParse(block.input);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    // The status only: an SDK error can quote the request, which holds the
    // member's report.
    const status = (err as { status?: unknown })?.status;
    console.error(
      `[report_bug] the AI pass failed (${typeof status === "number" ? status : "no status"}); filing the plain report`,
    );
    return null;
  }
}

/** Whether "Improve with AI" can run on this deployment. */
export function reportAiAvailable(): boolean {
  return claudeClient().ok;
}
