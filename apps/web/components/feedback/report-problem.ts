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

// Whether a reporter is mounted to hear the request. The hub layout mounts
// one only for a signed-in member, so an error page shown to a signed-out
// visitor must not offer a Report button that does nothing.
let mounted = 0;
const watchers = new Set<() => void>();

/** FeedbackGate calls this while it is mounted. Returns the unregister. */
export function registerReporter(): () => void {
  mounted += 1;
  watchers.forEach((w) => w());
  return () => {
    mounted -= 1;
    watchers.forEach((w) => w());
  };
}

export function subscribeReporter(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

export function reporterMounted(): boolean {
  return mounted > 0;
}

export function openReportProblem(request: ReportProblemRequest = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ReportProblemRequest>(REPORT_PROBLEM_EVENT, {
      detail: request,
    }),
  );
}
