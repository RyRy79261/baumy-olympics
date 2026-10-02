import { z } from "zod";

// An in-app bug or feature report at its boundary (issue #133, after
// camp-404 `apps/web/app/feedback/actions.ts`). `report_bug` parses with
// `ReportBugInput`; the dialog reads the limits so it never builds what the
// server refuses. The report becomes an issue on a PUBLIC tracker, so every
// free-text field is capped here and redacted again on the server.

export const REPORT_KINDS = ["bug", "feature"] as const;
export const ReportKind = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKind>;

export const REPORT_DESCRIPTION_MAX = 5000;

/**
 * What the member's device attaches when they tick "Attach device details
 * and recent errors". The server refuses anything bigger.
 */
export const DIAGNOSTICS_LIMITS = {
  environmentFields: 12,
  label: 40,
  value: 300,
  errors: 10,
  source: 40,
  message: 400,
  route: 200,
} as const;

const L = DIAGNOSTICS_LIMITS;

export const ReportDiagnostics = z.strictObject({
  environment: z
    .array(
      z.strictObject({
        label: z.string().max(L.label),
        value: z.string().max(L.value),
      }),
    )
    .max(L.environmentFields),
  errors: z
    .array(
      z.strictObject({
        at: z.string().max(40),
        source: z.string().max(L.source),
        message: z.string().max(L.message),
        route: z.string().max(L.route).optional(),
      }),
    )
    .max(L.errors),
});
export type ReportDiagnostics = z.infer<typeof ReportDiagnostics>;

export const ReportBugInput = z.strictObject({
  kind: ReportKind.default("bug").describe("A bug, or a feature request."),
  description: z
    .string({ error: "Describe the problem." })
    .trim()
    .min(1, "Describe the problem.")
    .max(
      REPORT_DESCRIPTION_MAX,
      `Keep it to ${REPORT_DESCRIPTION_MAX} characters.`,
    ),
  /** The in-app path it was filed from, never the query string. */
  route: z.string().max(300).optional(),
  /** "Improve with AI": restructure the report before filing. */
  useAi: z.boolean().optional(),
  /** Only when the member ticked the box, and exactly what they saw. */
  diagnostics: ReportDiagnostics.optional(),
});
export type ReportBugInput = z.infer<typeof ReportBugInput>;
