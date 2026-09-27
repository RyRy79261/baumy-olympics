// Test-only control for the server clock (lib/clock.ts). Answers 404, exactly
// like a route that does not exist, unless E2E_TEST_MODE=1; and test mode
// refuses to boot on Vercel (lib/test-mode.ts), so no deployment serves it.
//
//   GET  /api/test/clock                     -> { now, offsetMs }
//   POST /api/test/clock { advanceMs: n }    move forward n ms (negative: back)
//   POST /api/test/clock { offsetMs: n }     set the offset to n ms
//   POST /api/test/clock { reset: true }     back to real time
//
// The e2e helper is `advanceClock(page, ms)` in e2e/lib/clock.ts.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  advanceClock,
  clockOffsetMs,
  now,
  resetClock,
  setClockOffset,
} from "@/lib/clock";
import { isTestMode } from "@/lib/test-mode";

// Read at request time, never prerendered: the answer depends on the env and
// on the moment it is asked.
export const dynamic = "force-dynamic";

// Ten years either way is far more than any spec needs, and keeps the result a
// valid Date.
const MAX_MS = 10 * 366 * 24 * 60 * 60 * 1000;
const ms = z.number().int().min(-MAX_MS).max(MAX_MS);

const Body = z.union([
  z.strictObject({ advanceMs: ms }),
  z.strictObject({ offsetMs: ms }),
  z.strictObject({ reset: z.literal(true) }),
]);

function notFound() {
  return new NextResponse(null, { status: 404 });
}

function state() {
  return NextResponse.json({
    now: now().toISOString(),
    offsetMs: clockOffsetMs(),
  });
}

export function GET() {
  if (!isTestMode()) return notFound();
  return state();
}

export async function POST(request: Request) {
  if (!isTestMode()) return notFound();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Send exactly one of { advanceMs }, { offsetMs } or { reset: true }.",
      },
      { status: 400 },
    );
  }

  const body = parsed.data;
  if ("advanceMs" in body) advanceClock(body.advanceMs);
  else if ("offsetMs" in body) setClockOffset(body.offsetMs);
  else resetClock();
  return state();
}
