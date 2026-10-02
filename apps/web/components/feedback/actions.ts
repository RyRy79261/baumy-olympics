"use server";

import { kioskActionInput } from "@/lib/actions/kiosk";
import type { ReportBugData } from "@/lib/actions/report-bug";
import type { ActionResult } from "@/lib/actions/result";
import { actionInput } from "@/lib/actions/ui";

// The reporter's two doors to `report_bug` (issue #133): thin wrappers
// around the registry, as the signed-in member on the hub, or as the member
// acting on the kitchen screen. The input is structured (the diagnostics
// are nested), and the action's own schema parses it.

export async function reportBugAction(
  input: unknown,
  requestId: string,
): Promise<ActionResult<ReportBugData>> {
  return actionInput("report_bug", input, requestId);
}

export async function kioskReportBugAction(
  input: unknown,
  requestId: string,
): Promise<ActionResult<ReportBugData>> {
  return kioskActionInput("report_bug", input, requestId);
}
