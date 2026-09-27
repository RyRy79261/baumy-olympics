import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  berlinParts,
  berlinWallTimeToUtc,
  berlinWeekday,
  formatBerlinDateTime,
  isBerlinMonday,
  nextBerlinMonday,
  seasonBounds,
  seasonYear,
  startOfBerlinDay,
} from "../time";

const iso = (s: string) => new Date(s);

describe("seasons", () => {
  it("puts 23:30 on Dec 31 Berlin time in that year", () => {
    // 22:30Z is already 1 Jan in no zone west of Berlin, but it is 23:30 in
    // Berlin, and the season is Berlin's calendar year.
    const at = berlinWallTimeToUtc(2026, 12, 31, 23, 30);
    expect(at.toISOString()).toBe("2026-12-31T22:30:00.000Z");
    expect(seasonYear(at)).toBe(2026);
    // Whereas 00:30 Berlin on 1 Jan is still 31 Dec in UTC.
    expect(seasonYear(iso("2026-12-31T23:30:00Z"))).toBe(2027);
  });

  it("bounds a season by 1 Jan 00:00 Berlin, end exclusive", () => {
    const { startsAt, endsAt } = seasonBounds(2026);
    expect(startsAt.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(seasonYear(startsAt)).toBe(2026);
    expect(seasonYear(new Date(endsAt.getTime() - 1))).toBe(2026);
    expect(seasonYear(endsAt)).toBe(2027);
  });

  it("assigns every instant to the season whose bounds contain it", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2000-01-01T00:00:00Z"),
          max: new Date("2100-01-01T00:00:00Z"),
          noInvalidDate: true,
        }),
        (at) => {
          const { startsAt, endsAt } = seasonBounds(seasonYear(at));
          expect(at.getTime()).toBeGreaterThanOrEqual(startsAt.getTime());
          expect(at.getTime()).toBeLessThan(endsAt.getTime());
        },
      ),
    );
  });
});

describe("wall time across daylight saving", () => {
  it("uses +01:00 in winter and +02:00 in summer", () => {
    expect(berlinWallTimeToUtc(2026, 1, 15, 12).toISOString()).toBe(
      "2026-01-15T11:00:00.000Z",
    );
    expect(berlinWallTimeToUtc(2026, 7, 15, 12).toISOString()).toBe(
      "2026-07-15T10:00:00.000Z",
    );
  });

  it("handles the change days (29 Mar and 25 Oct 2026)", () => {
    // Spring forward: 02:00 → 03:00, a 23-hour day.
    const mar29 = berlinWallTimeToUtc(2026, 3, 29);
    const mar30 = berlinWallTimeToUtc(2026, 3, 30);
    expect(mar29.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(mar30.getTime() - mar29.getTime()).toBe(23 * 3600_000);
    expect(berlinWallTimeToUtc(2026, 3, 29, 3).toISOString()).toBe(
      "2026-03-29T01:00:00.000Z",
    );
    // Fall back: 03:00 → 02:00, a 25-hour day.
    const oct25 = berlinWallTimeToUtc(2026, 10, 25);
    const oct26 = berlinWallTimeToUtc(2026, 10, 26);
    expect(oct26.getTime() - oct25.getTime()).toBe(25 * 3600_000);
    expect(startOfBerlinDay(iso("2026-10-25T22:59:59Z"))).toEqual(oct25);
    // Wall times just before each change, where the offset at the naive
    // guess differs from the offset at the answer.
    expect(berlinWallTimeToUtc(2026, 3, 29, 1, 30).toISOString()).toBe(
      "2026-03-29T00:30:00.000Z",
    );
    expect(berlinWallTimeToUtc(2026, 10, 25, 1, 30).toISOString()).toBe(
      "2026-10-24T23:30:00.000Z",
    );
    expect(startOfBerlinDay(iso("2026-03-29T21:59:59Z"))).toEqual(mar29);
  });

  it("round-trips any Berlin midnight", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (y, m, d) => {
          const p = berlinParts(berlinWallTimeToUtc(y, m, d));
          expect([p.year, p.month, p.day, p.hour, p.minute, p.second]).toEqual([
            y,
            m,
            d,
            0,
            0,
            0,
          ]);
        },
      ),
    );
  });

  it("reads wall time off instants with milliseconds, before 1970 too", () => {
    expect(berlinParts(iso("2026-07-15T10:00:00.999Z"))).toMatchObject({
      hour: 12,
      second: 0,
    });
    expect(berlinWallTimeToUtc(1960, 1, 1).toISOString()).toBe(
      "1959-12-31T23:00:00.000Z",
    );
  });
});

describe("weekdays and Mondays", () => {
  it("reads the weekday in Berlin, not UTC", () => {
    // Sunday 27 Sep 2026, 23:30Z is already Monday 01:30 in Berlin.
    const late = iso("2026-09-27T23:30:00Z");
    expect(late.getUTCDay()).toBe(0);
    expect(berlinWeekday(late)).toBe(1);
    expect(isBerlinMonday(late)).toBe(true);
    expect(berlinWeekday(iso("2026-09-27T12:00:00Z"))).toBe(7);
    expect(isBerlinMonday(iso("2026-09-27T12:00:00Z"))).toBe(false);
  });

  it("finds the next Monday 00:00 Berlin, strictly after", () => {
    const monday = berlinWallTimeToUtc(2026, 9, 28);
    expect(nextBerlinMonday(iso("2026-09-24T09:00:00Z"))).toEqual(monday);
    expect(nextBerlinMonday(new Date(monday.getTime() - 1))).toEqual(monday);
    expect(nextBerlinMonday(monday)).toEqual(berlinWallTimeToUtc(2026, 10, 5));
  });

  it("lands on Monday midnight across the October change", () => {
    // Thursday 22 Oct (summer time) → Monday 26 Oct (winter time).
    const next = nextBerlinMonday(berlinWallTimeToUtc(2026, 10, 22, 12));
    expect(next.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("always returns a Berlin Monday midnight within a week", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2000-01-01T00:00:00Z"),
          max: new Date("2100-01-01T00:00:00Z"),
          noInvalidDate: true,
        }),
        (at) => {
          const next = nextBerlinMonday(at);
          const p = berlinParts(next);
          expect(p.weekday).toBe(1);
          expect([p.hour, p.minute, p.second]).toEqual([0, 0, 0]);
          expect(next.getTime()).toBeGreaterThan(at.getTime());
          expect(next.getTime() - at.getTime()).toBeLessThanOrEqual(
            7 * 24 * 3600_000 + 3600_000,
          );
        },
      ),
    );
  });
});

describe("formatBerlinDateTime", () => {
  it("reads Berlin wall time in summer and in winter", () => {
    // 06:00Z is 08:00 in Berlin summer time (+2h).
    expect(formatBerlinDateTime(iso("2026-09-30T06:00:00Z"))).toBe(
      "Wed 30 Sep, 08:00",
    );
    // 06:05Z is 07:05 in Berlin winter time (+1h).
    expect(formatBerlinDateTime(iso("2026-01-05T06:05:00Z"))).toBe(
      "Mon 5 Jan, 07:05",
    );
  });

  it("puts a UTC evening on the next Berlin day", () => {
    expect(formatBerlinDateTime(iso("2026-12-31T23:30:00Z"))).toBe(
      "Fri 1 Jan, 00:30",
    );
  });
});
