import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NIGHT_WINDOW,
  formatNightWindow,
  isNightAt,
  kioskNightWindow,
  nightWindowFromEnv,
  parseNightWindow,
} from "./night";

// Night mode's schedule (SPEC §8): 23:00 to 06:30 Berlin wall time, on the
// nights the clocks change too. 2026's changes: Sun 29 Mar 02:00 CET → 03:00
// CEST, Sun 25 Oct 03:00 CEST → 02:00 CET.

const night = (iso: string) => isNightAt(new Date(iso), DEFAULT_NIGHT_WINDOW);

/** Minutes of night between two instants, sampled every minute. */
function nightMinutes(fromIso: string, toIso: string): number {
  let count = 0;
  for (let t = Date.parse(fromIso); t < Date.parse(toIso); t += 60_000) {
    if (isNightAt(new Date(t), DEFAULT_NIGHT_WINDOW)) count++;
  }
  return count;
}

afterEach(() => vi.restoreAllMocks());

describe("isNightAt", () => {
  it("starts at 23:00 and ends at 06:30 Berlin time in winter (UTC+1)", () => {
    expect(night("2026-01-14T21:59:00Z")).toBe(false); // 22:59
    expect(night("2026-01-14T22:00:00Z")).toBe(true); // 23:00
    expect(night("2026-01-14T23:30:00Z")).toBe(true); // 00:30
    expect(night("2026-01-15T05:29:59Z")).toBe(true); // 06:29
    expect(night("2026-01-15T05:30:00Z")).toBe(false); // 06:30
    expect(night("2026-01-15T11:00:00Z")).toBe(false); // noon
  });

  it("reads Berlin's clock in summer (UTC+2), not UTC's", () => {
    // 21:00 UTC is 23:00 in July but 22:00 in January.
    expect(night("2026-07-14T21:00:00Z")).toBe(true);
    expect(night("2026-01-14T21:00:00Z")).toBe(false);
    // 05:00 UTC is 07:00 in July but 06:00 in January.
    expect(night("2026-07-15T05:00:00Z")).toBe(false);
    expect(night("2026-01-15T05:00:00Z")).toBe(true);
  });

  it("lasts an hour longer the night the clocks go back", () => {
    // Sat 24 Oct 23:00 CEST (21:00Z) to Sun 25 Oct 06:30 CET (05:30Z).
    expect(night("2026-10-24T20:59:00Z")).toBe(false);
    expect(night("2026-10-24T21:00:00Z")).toBe(true);
    // 02:30 happens twice; both are night.
    expect(night("2026-10-25T00:30:00Z")).toBe(true);
    expect(night("2026-10-25T01:30:00Z")).toBe(true);
    expect(night("2026-10-25T05:29:00Z")).toBe(true);
    expect(night("2026-10-25T05:30:00Z")).toBe(false);
    expect(nightMinutes("2026-10-24T18:00:00Z", "2026-10-25T09:00:00Z")).toBe(
      7.5 * 60 + 60, // 7h30 of wall time, plus the repeated hour
    );
  });

  it("lasts an hour less the night the clocks go forward", () => {
    // Sat 28 Mar 23:00 CET (22:00Z) to Sun 29 Mar 06:30 CEST (04:30Z).
    expect(night("2026-03-28T21:59:00Z")).toBe(false);
    expect(night("2026-03-28T22:00:00Z")).toBe(true);
    expect(night("2026-03-29T01:00:00Z")).toBe(true); // 03:00 CEST
    expect(night("2026-03-29T04:29:00Z")).toBe(true);
    expect(night("2026-03-29T04:30:00Z")).toBe(false);
    expect(nightMinutes("2026-03-28T18:00:00Z", "2026-03-29T09:00:00Z")).toBe(
      7.5 * 60 - 60, // 7h30 of wall time, minus the skipped hour
    );
  });

  it("handles a window inside one day, and no window at all", () => {
    const lunch = { startMin: 13 * 60, endMin: 14 * 60 };
    expect(isNightAt(new Date("2026-01-14T12:30:00Z"), lunch)).toBe(true);
    expect(isNightAt(new Date("2026-01-14T11:59:00Z"), lunch)).toBe(false);
    expect(isNightAt(new Date("2026-01-14T13:00:00Z"), lunch)).toBe(false);
    expect(isNightAt(new Date("2026-01-14T23:00:00Z"), null)).toBe(false);
  });
});

describe("parseNightWindow", () => {
  it("reads HH:MM-HH:MM and off", () => {
    expect(parseNightWindow("23:00-06:30")).toEqual(DEFAULT_NIGHT_WINDOW);
    expect(parseNightWindow(" 22:15 - 07:05 ")).toEqual({
      startMin: 22 * 60 + 15,
      endMin: 7 * 60 + 5,
    });
    expect(parseNightWindow("OFF")).toBeNull();
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      "23:00",
      "23:00-06:30-07:00",
      "24:00-06:00",
      "23:60-06:00",
      "7:00-08:00",
      "23:00-23:00",
      "night",
    ]) {
      expect(parseNightWindow(bad), bad).toBeUndefined();
    }
  });
});

describe("nightWindowFromEnv", () => {
  it("defaults to 23:00-06:30 when unset or blank", () => {
    expect(nightWindowFromEnv({})).toEqual(DEFAULT_NIGHT_WINDOW);
    expect(nightWindowFromEnv({ KIOSK_NIGHT_HOURS: " " })).toEqual(
      DEFAULT_NIGHT_WINDOW,
    );
  });

  it("takes a window or off", () => {
    expect(nightWindowFromEnv({ KIOSK_NIGHT_HOURS: "22:00-07:00" })).toEqual({
      startMin: 22 * 60,
      endMin: 7 * 60,
    });
    expect(nightWindowFromEnv({ KIOSK_NIGHT_HOURS: "off" })).toBeNull();
  });

  it("falls back to the default, and says so, on a typo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(nightWindowFromEnv({ KIOSK_NIGHT_HOURS: "11pm-6am" })).toEqual(
      DEFAULT_NIGHT_WINDOW,
    );
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("kioskNightWindow", () => {
  it("reads KIOSK_NIGHT_HOURS and ignores the test cookie outside test mode", () => {
    expect(kioskNightWindow(undefined, {})).toEqual(DEFAULT_NIGHT_WINDOW);
    expect(
      kioskNightWindow("13:00-14:00", { KIOSK_NIGHT_HOURS: "off" }),
    ).toBeNull();
  });

  it("is off in e2e test mode unless the browser's cookie sets a window", () => {
    const env = { E2E_TEST_MODE: "1", KIOSK_NIGHT_HOURS: "22:00-07:00" };
    expect(kioskNightWindow(undefined, env)).toBeNull();
    expect(kioskNightWindow("nonsense", env)).toBeNull();
    expect(kioskNightWindow("23:00-06:30", env)).toEqual(DEFAULT_NIGHT_WINDOW);
  });
});

describe("formatNightWindow", () => {
  it("writes the window back as HH:MM-HH:MM", () => {
    expect(formatNightWindow(DEFAULT_NIGHT_WINDOW)).toBe("23:00-06:30");
    expect(formatNightWindow({ startMin: 5, endMin: 65 })).toBe("00:05-01:05");
  });
});
