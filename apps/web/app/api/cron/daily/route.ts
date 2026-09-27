// The daily job (SPEC §6.7): Vercel calls `GET /api/cron/daily` at 02:00 UTC
// (apps/web/vercel.json) with `Authorization: Bearer $CRON_SECRET`. It runs
// the same sweep a hub page load runs (lib/background-work.ts) at the
// server's `now()`, and answers what each step did.
//
// Fails closed: with no CRON_SECRET set it answers 503 and runs nothing, and
// any other caller gets 401. The secret is compared in constant time.

import { NextResponse } from "next/server";
import { runSweep } from "@/lib/background-work";
import { now } from "@/lib/clock";
import { bearerMatches } from "@/lib/http/bearer";

export const dynamic = "force-dynamic";
// The sweep can take a while on a Monday (every chore is measured).
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET is not set on this deployment, so the daily job does not run.",
      },
      { status: 503 },
    );
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const report = await runSweep(now());
  const ok = report.steps.every((s) => s.ok);
  return NextResponse.json({ ok, ...report }, { status: ok ? 200 : 500 });
}
