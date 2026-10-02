import {
  sanitizeReportText,
  screenReport,
  type RedactionKind,
} from "@baumy/core";
import {
  REPORT_DESCRIPTION_MAX,
  ReportBugInput,
  type ReportDiagnostics,
} from "@baumy/types";
import { structureWithAi } from "@/lib/feedback/ai";
import { FEEDBACK_UNAVAILABLE_MESSAGE } from "@/lib/feedback/config";
import { buildFeedbackIssue } from "@/lib/feedback/issue";
import {
  githubIssues,
  type IssueFailureReason,
} from "@/lib/integrations/github";
import { defineAction } from "./define";
import { fail, type ActionFailure } from "./result";

// Shake to report a bug (issue #133): the in-app reporter files a GitHub
// issue on the household's PUBLIC tracker. The flow is camp-404
// `apps/web/app/feedback/actions.ts`'s, as an action (ADR 0002):
//
//   1. the tracker must be set up (else NOT_CONFIGURED, before any AI call);
//   2. the description is redacted; nothing left → INVALID_INPUT;
//   3. screenReport holds a report that addresses its reader, asks for data
//      or carries someone else's identifiers (`needs-human`, no AI pass), and
//      withholds the diagnostics when a third party is in them;
//   4. the optional AI pass restructures the redacted text;
//   5. the issue is built (everything redacted again) and posted.
//
// The issue names the reporter only by their opaque member id, never by name
// or email. Nothing of the report is kept here: the audit row holds the kind
// and the issue number, and the ledger the issue's number and link.
//
// `transactional: false`: GitHub (and Claude) are called with no
// transaction open. There is no undo: an issue the audit row failed to
// record stays filed, which is the lesser harm next to losing the report.

export interface ReportBugData {
  /** The issue's number; its link. */
  number: number;
  url: string;
}

/** Each GitHub failure as a sentence the member can act on. */
export function issueFailure(reason: IssueFailureReason): ActionFailure {
  switch (reason) {
    case "invalid_token":
      return fail(
        "UNAVAILABLE",
        "GitHub refused the bug tracker's token. A household admin needs to renew it.",
      );
    case "no_access":
      return fail(
        "UNAVAILABLE",
        "The bug tracker can't be reached with its token. Let a household admin know.",
      );
    case "issues_disabled":
      return fail(
        "UNAVAILABLE",
        "Issues are turned off on the bug tracker. Let a household admin know.",
      );
    case "timeout":
    case "unavailable":
      return fail(
        "UNAVAILABLE",
        "Couldn't reach the bug tracker just now. Please try again in a minute.",
      );
  }
}

/** Every piece of text in the diagnostics, for the redaction screen. */
function diagnosticsKinds(d: ReportDiagnostics): RedactionKind[] {
  return [
    ...d.environment.flatMap((f) => [f.label, f.value]),
    ...d.errors.flatMap((e) => [e.source, e.message, e.route ?? ""]),
  ].flatMap(
    (text) => sanitizeReportText(text, REPORT_DESCRIPTION_MAX).redacted,
  );
}

export const reportBug = defineAction({
  name: "report_bug",
  title: "Report a bug",
  description:
    "Files a bug report or feature request as an issue on the household's public GitHub tracker, redacted of personal data. Only from the in-app reporter.",
  consent: "File bug reports on the household's public tracker",
  kind: "write",
  risk: "safe",
  // The hub and the kitchen screen only: a report is a person's own words.
  surfaces: ["ui", "kiosk"],
  requires: "member",
  transactional: false,
  // Each report is a public issue and may spend an AI call (camp-404 allows
  // 3 a minute and 10 per address).
  rateLimit: { perMember: 5, perIp: 10, windowMs: 10 * 60_000 },
  input: ReportBugInput,
  async execute(ctx, i) {
    const tracker = githubIssues();
    if (!tracker.ok) {
      return fail(
        "NOT_CONFIGURED",
        FEEDBACK_UNAVAILABLE_MESSAGE[tracker.reason],
      );
    }

    // Redact once up front: a report that is empty once HTML and PII are
    // stripped is refused, and only the clean text goes to the model.
    const cleaned = sanitizeReportText(i.description, REPORT_DESCRIPTION_MAX);
    if (!cleaned.text) {
      return fail("INVALID_INPUT", "Describe the problem in words.", {
        issues: [
          { path: ["description"], message: "Describe the problem in words." },
        ],
      });
    }

    const screen = screenReport(i.description, cleaned.redacted);
    const withhold =
      i.diagnostics !== undefined &&
      (screen.withholdDiagnostics ||
        screenReport("", diagnosticsKinds(i.diagnostics)).withholdDiagnostics);

    const structured =
      i.useAi && !screen.needsHuman
        ? await structureWithAi(i.kind, cleaned.text)
        : null;

    const issue = buildFeedbackIssue({
      kind: i.kind,
      // The raw text: the builder redacts it again and notes what it removed.
      description: i.description,
      // requireMember has checked there is one.
      reporterRef: ctx.actor.memberId!,
      surface: ctx.source === "kiosk" ? "kiosk" : "ui",
      route: i.route,
      structured,
      flags: screen.flags,
      diagnostics: withhold ? null : i.diagnostics,
      diagnosticsWithheld: withhold,
    });

    const filed = await tracker.create(issue);
    if (!filed.ok) {
      console.error(
        `[report_bug] GitHub answered ${filed.status ?? filed.reason}`,
      );
      return issueFailure(filed.reason);
    }
    const data: ReportBugData = { number: filed.number, url: filed.url };
    return {
      ok: true,
      data,
      audit: {
        entity: "bug_report",
        entityId: String(filed.number),
        // Never the report's words: they live on the tracker, redacted.
        payload: {
          kind: i.kind,
          number: filed.number,
          heldForAPerson: screen.needsHuman,
          improvedWithAi: structured !== null,
          diagnostics: i.diagnostics
            ? withhold
              ? "withheld"
              : "attached"
            : "none",
        },
      },
    };
  },
});
