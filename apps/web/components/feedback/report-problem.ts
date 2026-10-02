// Opening the reporter from anywhere (issue #133), after camp-404
// `apps/web/components/feedback/report-problem.ts`. The dialog lives once in
// each shell (FeedbackGate in the hub layout and the kiosk shell); an entry
// point asks it to open with an event, so no provider wraps the tree.

import type { ReportKind } from "@baumy/types";

export const REPORT_PROBLEM_EVENT = "baumy:report-problem";

export interface ReportProblemRequest {
  /** Text to start the description with, e.g. an error's trace code. */
  description?: string;
  /** Which type the dialog opens on; a bug when omitted. */
  kind?: ReportKind;
}

export function openReportProblem(request: ReportProblemRequest = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ReportProblemRequest>(REPORT_PROBLEM_EVENT, {
      detail: request,
    }),
  );
}
