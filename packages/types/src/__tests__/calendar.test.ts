import { describe, expect, it } from "vitest";
import {
  CalendarDate,
  CalendarEventId,
  CalendarEventUpdate,
  CalendarTime,
  EVENT_MAX_DAYS,
  EVENT_TITLE_MAX,
  EventRange,
  LIST_EVENTS_MAX_DAYS,
  NewCalendarEvent,
  daysBetween,
  isCalendarDate,
} from "../calendar";

function issues(r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]);
}

const timed = {
  title: "Dinner",
  kind: "timed",
  date: "2027-01-15",
  startTime: "19:00",
  endTime: "20:30",
} as const;

describe("CalendarDate and CalendarTime", () => {
  it("takes real dates and 24h times", () => {
    expect(CalendarDate.parse(" 2028-02-29 ")).toBe("2028-02-29");
    expect(CalendarTime.parse("00:00")).toBe("00:00");
    expect(CalendarTime.parse("23:59")).toBe("23:59");
  });

  it("refuses impossible dates, other formats and bad times", () => {
    for (const bad of ["2027-02-29", "2027-13-01", "15.01.2027", "2027-1-5"]) {
      expect(CalendarDate.safeParse(bad).success, bad).toBe(false);
    }
    for (const bad of ["24:00", "7:00", "19:60", "19:00:00"]) {
      expect(CalendarTime.safeParse(bad).success, bad).toBe(false);
    }
    expect(isCalendarDate("2027-04-31")).toBe(false);
  });

  it("counts whole days between dates, across a DST change", () => {
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(daysBetween("2027-01-02", "2027-01-01")).toBe(-1);
  });
});

describe("forMemberId (issue #134)", () => {
  it("takes one member's id, or nothing for the whole house", () => {
    const id = "6f1c2b9e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(NewCalendarEvent.parse({ ...timed, forMemberId: id })).toMatchObject(
      { forMemberId: id },
    );
    expect(NewCalendarEvent.parse(timed).forMemberId).toBeUndefined();
    expect(
      CalendarEventUpdate.parse({ ...timed, eventId: "abc12", forMemberId: id })
        .forMemberId,
    ).toBe(id);
  });

  it("refuses anything that is not a member id", () => {
    for (const bad of ["Ryan", "house", "123"]) {
      expect(
        issues(NewCalendarEvent.safeParse({ ...timed, forMemberId: bad })),
        bad,
      ).toEqual([["forMemberId", "Pick someone in the house."]]);
    }
  });
});

describe("CalendarEventId", () => {
  it("takes Google's base32hex ids and refuses anything else", () => {
    expect(CalendarEventId.parse("abc0123456789v")).toBe("abc0123456789v");
    expect(CalendarEventId.parse("abc123_20270115T180000Z")).toBe(
      "abc123_20270115T180000Z",
    );
    for (const bad of ["abcd", "abc/def", "abc def", "a-b-c-d", "abc%2F"]) {
      expect(CalendarEventId.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("NewCalendarEvent", () => {
  it("takes a timed event and an all-day one", () => {
    expect(NewCalendarEvent.parse({ ...timed, title: " Dinner " })).toEqual(
      timed,
    );
    expect(
      NewCalendarEvent.parse({
        title: "Trip",
        kind: "all_day",
        date: "2027-07-01",
        endDate: "2027-07-03",
      }),
    ).toMatchObject({ endDate: "2027-07-03" });
  });

  it("needs both times for a timed event, ending after it starts", () => {
    expect(
      issues(
        NewCalendarEvent.safeParse({
          title: "x",
          kind: "timed",
          date: "2027-01-15",
        }),
      ),
    ).toEqual([
      ["startTime", "Pick a start time."],
      ["endTime", "Pick an end time."],
    ]);
    expect(
      issues(NewCalendarEvent.safeParse({ ...timed, endTime: "19:00" })),
    ).toEqual([["endTime", "End after it starts, or pick a later last day."]]);
    // Past midnight is fine with a later last day.
    expect(
      NewCalendarEvent.safeParse({
        ...timed,
        endDate: "2027-01-16",
        endTime: "01:00",
      }).success,
    ).toBe(true);
  });

  it("refuses a last day before the first, or more than a year on", () => {
    expect(
      issues(NewCalendarEvent.safeParse({ ...timed, endDate: "2027-01-14" })),
    ).toEqual([["endDate", "The last day can't be before the first."]]);
    expect(
      issues(
        NewCalendarEvent.safeParse({
          title: "x",
          kind: "all_day",
          date: "2027-01-01",
          endDate: "2028-01-03",
        }),
      ),
    ).toEqual([
      ["endDate", `An event can last ${EVENT_MAX_DAYS} days at most.`],
    ]);
  });

  it("refuses a blank or long title, a bad kind and unknown fields", () => {
    expect(NewCalendarEvent.safeParse({ ...timed, title: "  " }).success).toBe(
      false,
    );
    expect(
      NewCalendarEvent.safeParse({
        ...timed,
        title: "x".repeat(EVENT_TITLE_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      NewCalendarEvent.safeParse({ ...timed, kind: "weekly" }).success,
    ).toBe(false);
    expect(
      NewCalendarEvent.safeParse({ ...timed, colour: "red" }).success,
    ).toBe(false);
  });
});

describe("CalendarEventUpdate", () => {
  it("is the fields plus the event's id, with the same checks", () => {
    expect(
      CalendarEventUpdate.parse({ ...timed, eventId: "abcdef123" }),
    ).toMatchObject({ eventId: "abcdef123", startTime: "19:00" });
    expect(CalendarEventUpdate.safeParse(timed).success).toBe(false);
    expect(
      issues(
        CalendarEventUpdate.safeParse({
          ...timed,
          eventId: "abcdef123",
          endTime: "18:00",
        }),
      ),
    ).toEqual([["endTime", "End after it starts, or pick a later last day."]]);
  });
});

describe("EventRange", () => {
  it("takes an empty range, one day, or up to the widest range", () => {
    expect(EventRange.parse({})).toEqual({});
    expect(EventRange.parse({ from: "2027-01-01", to: "2027-01-01" })).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
    });
    expect(
      EventRange.safeParse({ from: "2027-01-01", to: "2027-03-04" }).success,
    ).toBe(daysBetween("2027-01-01", "2027-03-04") <= LIST_EVENTS_MAX_DAYS);
  });

  it("refuses a backwards or too wide range", () => {
    expect(
      issues(EventRange.safeParse({ from: "2027-01-02", to: "2027-01-01" })),
    ).toEqual([["to", "The last day can't be before the first."]]);
    expect(
      issues(EventRange.safeParse({ from: "2027-01-01", to: "2027-06-01" })),
    ).toEqual([["to", `Ask for ${LIST_EVENTS_MAX_DAYS} days at most.`]]);
  });
});
