// Test-only window on the fake GitHub tracker (issue #133). Answers 404,
// exactly like a route that does not exist, unless E2E_TEST_MODE=1; and test
// mode refuses to boot on Vercel (lib/test-mode.ts), so no deployment serves
// it. A spec reads back what WOULD have been published, to check the report
// it filed was redacted and names nobody.
//
//   GET /api/test/github -> { issues: [{ number, title, body, labels }] }

import { NextResponse } from "next/server";
import { memoryIssues } from "@/lib/integrations/github-memory";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isTestMode()) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ issues: memoryIssues() });
}
