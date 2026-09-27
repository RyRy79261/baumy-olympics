// The household's one clock (SPEC §4.1 "Season", AGENTS.md "Time"). Every
// question about days, weekdays or seasons is answered in Europe/Berlin
// through this file, never with a hard-coded `+01:00`/`+02:00` and never in
// the host's zone (Vercel runs in UTC). Instants are plain `Date`s in UTC; the
// caller passes `now` (nothing here reads the clock).
//
// Pattern after camp-404 `packages/core/src/time-zone.ts`: pin the zone in the
// `Intl.DateTimeFormat` options.

export const BERLIN_TZ = "Europe/Berlin";

/** A Berlin wall-clock reading. `weekday` is ISO: 1 = Monday … 7 = Sunday. */
export interface BerlinParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const berlinFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The Berlin wall-clock reading of an instant. */
export function berlinParts(instant: Date): BerlinParts {
  const parts: Record<string, number> = {};
  for (const part of berlinFormat.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const year = parts.year as number;
  const month = parts.month as number;
  const day = parts.day as number;
  // getUTCDay: 0 = Sunday. The calendar date alone fixes the weekday.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
  return {
    year,
    month,
    day,
    hour: parts.hour as number,
    minute: parts.minute as number,
    second: parts.second as number,
    weekday,
  };
}

/** Berlin's offset from UTC at `instant`, in ms (+1h in winter, +2h in summer). */
function berlinOffsetMs(instant: number): number {
  const p = berlinParts(new Date(instant));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // The formatter drops milliseconds, so compare against the whole second.
  return wall - (instant - (((instant % 1000) + 1000) % 1000));
}

/**
 * The instant at which Berlin's clock reads the given wall time. Safe across
 * daylight-saving changes: the offset is looked up at the result, not at the
 * guess. Midnight is never skipped or repeated in Berlin (the changes happen
 * at 02:00/03:00), so the helpers below always land on an exact instant.
 */
export function berlinWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wall - berlinOffsetMs(wall);
  return new Date(wall - berlinOffsetMs(guess));
}

/** The season (calendar year in Berlin) that an instant belongs to. */
export function seasonYear(instant: Date): number {
  return berlinParts(instant).year;
}

/**
 * A season's bounds as UTC instants: `startsAt` is 1 Jan 00:00 Berlin and
 * `endsAt` is the next 1 Jan 00:00 Berlin (exclusive).
 */
export function seasonBounds(year: number): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: berlinWallTimeToUtc(year, 1, 1),
    endsAt: berlinWallTimeToUtc(year + 1, 1, 1),
  };
}

/** ISO weekday in Berlin: 1 = Monday … 7 = Sunday. */
export function berlinWeekday(instant: Date): number {
  return berlinParts(instant).weekday;
}

export function isBerlinMonday(instant: Date): boolean {
  return berlinWeekday(instant) === 1;
}

/** 00:00 Berlin on the Berlin calendar day of `instant`. */
export function startOfBerlinDay(instant: Date): Date {
  const p = berlinParts(instant);
  return berlinWallTimeToUtc(p.year, p.month, p.day);
}

/**
 * The first Monday 00:00 Berlin strictly after `after`. For "at least 48h
 * ahead" (SPEC §4.4), pass `now + 48h`.
 */
export function nextBerlinMonday(after: Date): Date {
  const p = berlinParts(after);
  // Days until the next Monday; a Monday itself moves on a whole week, since
  // its own 00:00 is not strictly after `after` (or is `after` exactly).
  const ahead = 8 - p.weekday;
  // Calendar arithmetic on the date alone, so a DST change in between cannot
  // shift the day.
  const target = new Date(
    Date.UTC(p.year, p.month - 1, p.day) + ahead * MS_PER_DAY,
  );
  return berlinWallTimeToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
  );
}
