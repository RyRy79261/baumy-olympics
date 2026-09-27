// The server's only source of "now" (AGENTS.md "Time"). Server code calls
// `now()` instead of `new Date()`, so every ActionCtx.now and every read path
// agrees on one clock.
//
// In E2E test mode (lib/test-mode.ts) `now()` adds an offset that specs set
// through POST /api/test/clock, so a spec can step past a 24h window without
// waiting. Playwright's own clock only moves the browser, never this process.
// Outside test mode the offset cannot be set, and `now()` ignores it even if
// something wrote one.
//
// The offset lives on globalThis, not in a module variable, because Next can
// load this module more than once in one server (one copy per route bundle);
// a module variable would give the route that sets it and the page that reads
// it different clocks. It is per process, which matches `next start` in the
// e2e harness. Specs that move it run serially (e2e/specs/clock.spec.ts).

import { isTestMode } from "./test-mode";

const OFFSET_KEY = Symbol.for("baumy.clock.offsetMs");

type ClockGlobal = typeof globalThis & { [OFFSET_KEY]?: number };

function readOffset(): number {
  return (globalThis as ClockGlobal)[OFFSET_KEY] ?? 0;
}

function writeOffset(ms: number): void {
  (globalThis as ClockGlobal)[OFFSET_KEY] = ms;
}

/** The current time: real time, plus the test offset in E2E test mode. */
export function now(): Date {
  const real = Date.now();
  return new Date(isTestMode() ? real + readOffset() : real);
}

/** The offset `now()` applies right now: always 0 outside test mode. */
export function clockOffsetMs(): number {
  return isTestMode() ? readOffset() : 0;
}

function requireTestMode(): void {
  if (!isTestMode()) {
    throw new Error("The test clock can only be moved when E2E_TEST_MODE=1.");
  }
}

/** Set the offset to `ms`. Test mode only. */
export function setClockOffset(ms: number): void {
  requireTestMode();
  writeOffset(ms);
}

/** Move the clock forward by `ms` (negative moves it back). Test mode only. */
export function advanceClock(ms: number): void {
  requireTestMode();
  writeOffset(readOffset() + ms);
}

/** Back to real time. Test mode only. */
export function resetClock(): void {
  requireTestMode();
  writeOffset(0);
}
