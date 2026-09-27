// Move the SERVER clock (apps/web/lib/clock.ts) from a spec. Playwright's
// `page.clock` only moves the browser; anything the server decides from "now"
// (ActionCtx.now, read paths) needs this instead, or as well.
//
// The offset is per server process and shared by every worker, so a spec that
// moves it must run serially and reset it afterwards (see specs/clock.spec.ts).

import { expect, type Page } from "@playwright/test";

export type ServerClock = { now: string; offsetMs: number };

async function send(page: Page, data: object): Promise<ServerClock> {
  const res = await page.request.post("/api/test/clock", { data });
  expect(
    res.status(),
    "POST /api/test/clock failed: is the server running with E2E_TEST_MODE=1?",
  ).toBe(200);
  return (await res.json()) as ServerClock;
}

/** Move the server clock forward by `ms` (negative moves it back). */
export function advanceClock(page: Page, ms: number): Promise<ServerClock> {
  return send(page, { advanceMs: ms });
}

/** Put the server clock back on real time. */
export function resetClock(page: Page): Promise<ServerClock> {
  return send(page, { reset: true });
}

/** Read the server clock. */
export async function serverClock(page: Page): Promise<ServerClock> {
  const res = await page.request.get("/api/test/clock");
  expect(res.status()).toBe(200);
  return (await res.json()) as ServerClock;
}
