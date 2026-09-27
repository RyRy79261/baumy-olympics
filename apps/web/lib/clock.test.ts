import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceClock,
  clockOffsetMs,
  now,
  resetClock,
  setClockOffset,
} from "./clock";

const REAL = new Date("2026-09-27T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ now: REAL, toFake: ["Date"] });
});

afterEach(() => {
  // Leave the shared offset at zero for the next test, whatever mode it used.
  vi.stubEnv("E2E_TEST_MODE", "1");
  resetClock();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("now() in test mode", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_TEST_MODE", "1");
  });

  it("is real time until an offset is set", () => {
    expect(now().toISOString()).toBe(REAL.toISOString());
    expect(clockOffsetMs()).toBe(0);
  });

  it("applies an advance, and advances accumulate", () => {
    advanceClock(DAY);
    expect(now().getTime()).toBe(REAL.getTime() + DAY);
    advanceClock(-2 * DAY);
    expect(now().getTime()).toBe(REAL.getTime() - DAY);
    expect(clockOffsetMs()).toBe(-DAY);
  });

  it("setClockOffset replaces the offset and resetClock clears it", () => {
    advanceClock(DAY);
    setClockOffset(5_000);
    expect(now().getTime()).toBe(REAL.getTime() + 5_000);
    resetClock();
    expect(now().getTime()).toBe(REAL.getTime());
  });

  it("keeps following real time under the offset", () => {
    advanceClock(DAY);
    vi.advanceTimersByTime(1_000);
    expect(now().getTime()).toBe(REAL.getTime() + DAY + 1_000);
  });

  it("shares the offset through globalThis across module copies", async () => {
    advanceClock(DAY);
    vi.resetModules();
    const fresh = await import("./clock");
    expect(fresh.now().getTime()).toBe(REAL.getTime() + DAY);
  });
});

describe("now() outside test mode", () => {
  it("returns real time", () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    expect(now().toISOString()).toBe(REAL.toISOString());
  });

  it("refuses to move the clock", () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    expect(() => advanceClock(DAY)).toThrow(/E2E_TEST_MODE=1/);
    expect(() => setClockOffset(DAY)).toThrow(/E2E_TEST_MODE=1/);
    expect(() => resetClock()).toThrow(/E2E_TEST_MODE=1/);
  });

  it("ignores an offset left over from test mode", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    advanceClock(DAY);
    expect(now().getTime()).toBe(REAL.getTime() + DAY);

    vi.stubEnv("E2E_TEST_MODE", "");
    expect(now().getTime()).toBe(REAL.getTime());
    expect(clockOffsetMs()).toBe(0);
  });
});
