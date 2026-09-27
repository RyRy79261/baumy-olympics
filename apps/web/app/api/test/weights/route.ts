// Test-only trigger for the weekly weight jobs (SPEC §4.4, §6.7). Answers
// 404, exactly like a route that does not exist, unless E2E_TEST_MODE=1; and
// test mode refuses to boot on Vercel (lib/test-mode.ts), so no deployment
// serves it. Until the daily job (issue #18) calls them, this is how a spec
// runs `computeSuggestions` and `applyDueSuggestions` at the server's now().
//
//   POST /api/test/weights { run: "compute" } -> { measured, suggested }
//   POST /api/test/weights { run: "apply" }   -> { applied }

import { NextResponse } from "next/server";
import { z } from "zod";
import { withTransaction, type Queryable } from "@baumy/db";
import { applyDueSuggestions, computeSuggestions } from "@baumy/db/weights";
import { now } from "@/lib/clock";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

const Body = z.strictObject({ run: z.enum(["compute", "apply"]) });

export async function POST(request: Request) {
  if (!isTestMode()) return new NextResponse(null, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Send { run: "compute" } or { run: "apply" }.' },
      { status: 400 },
    );
  }
  const at = now();
  if (parsed.data.run === "compute") {
    const r = await withTransaction((tx) =>
      computeSuggestions(tx as unknown as Queryable, at),
    );
    return NextResponse.json({
      measured: r.measured,
      suggested: r.suggested.length,
    });
  }
  const applied = await withTransaction((tx) =>
    applyDueSuggestions(tx as unknown as Queryable, at),
  );
  return NextResponse.json({ applied: applied.length });
}
