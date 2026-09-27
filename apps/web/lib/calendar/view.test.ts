import { describe, expect, it } from "vitest";
import {
  eventView,
  eventsOnDay,
  isOnDay,
  parseViewParams,
  viewLabel,
  viewRange,
  whenLabel,
  type EventLike,
} from "./view";

const timed: EventLike = {
  id: "evt00001",
  title: "Dinner",
  description: null,
  location: null,
  allDay: false,
  start: "2027-01-15T18:00:00.000Z",
  end: "2027-01-15T19:30:00.000Z",
  member: "m-1",
};

describe("eventView", () => {
  it("shows a timed event in Berlin time, in winter and in summer", () => {
    expect(eventView(timed)).toMatchObject({
      startDate: "2027-01-15",
      endDate: "2027-01-15",
      startTime: "19:00",
      endTime: "20:30",
      when: "Fri 15 Jan, 19:00–20:30",
      addedBy: "m-1",
    });
    expect(
      eventView({
        ...timed,
        start: "2027-07-15T17:00:00.000Z",
        end: "2027-07-15T18:00:00.000Z",
      }),
    ).toMatchObject({ startTime: "19:00", when: "Thu 15 Jul, 19:00–20:00" });
  });

  it("gives an all-day event its last day, not Google's exclusive end", () => {
    expect(
      eventView({
        ...timed,
        allDay: true,
        start: "2027-07-01",
        end: "2027-07-04",
      }),
    ).toMatchObject({
      startDate: "2027-07-01",
      endDate: "2027-07-03",
      startTime: null,
      when: "Thu 1 Jul – Sat 3 Jul, all day",
    });
    // A broken end (before the start) reads as one day.
    expect(
      eventView({
        ...timed,
        allDay: true,
        start: "2027-07-01",
        end: "2027-07-01",
      }),
    ).toMatchObject({ endDate: "2027-07-01", when: "Thu 1 Jul, all day" });
  });

  it("labels an event over midnight with both days", () => {
    expect(
      whenLabel({
        allDay: false,
        startDate: "2027-01-15",
        endDate: "2027-01-16",
        startTime: "22:00",
        endTime: "01:00",
      }),
    ).toBe("Fri 15 Jan, 22:00 – Sat 16 Jan, 01:00");
  });
});

describe("eventsOnDay", () => {
  const allDay = eventView({
    ...timed,
    id: "allday01",
    allDay: true,
    start: "2027-01-14",
    end: "2027-01-17",
  });
  const late = eventView({
    ...timed,
    id: "late0001",
    start: "2027-01-15T21:00:00.000Z",
    // Ends at 00:00 Berlin on the 16th.
    end: "2027-01-15T23:00:00.000Z",
  });
  const dinner = eventView(timed);

  it("puts all-day events first, then by start", () => {
    expect(
      eventsOnDay([late, dinner, allDay], "2027-01-15").map((e) => e.id),
    ).toEqual(["allday01", "evt00001", "late0001"]);
  });

  it("leaves a timed event off the day it ends at midnight", () => {
    expect(late.endDate).toBe("2027-01-16");
    expect(isOnDay(late, "2027-01-16")).toBe(false);
    expect(isOnDay(allDay, "2027-01-16")).toBe(true);
    expect(isOnDay(allDay, "2027-01-17")).toBe(false);
  });
});

describe("viewRange", () => {
  it("is one day for the day view", () => {
    expect(viewRange("day", "2027-01-15")).toEqual({
      view: "day",
      date: "2027-01-15",
      days: ["2027-01-15"],
      from: "2027-01-15",
      to: "2027-01-15",
      prev: "2027-01-14",
      next: "2027-01-16",
      title: "Fri 15 Jan 2027",
      month: null,
    });
  });

  it("is Monday to Sunday for the week view", () => {
    const w = viewRange("week", "2027-01-15");
    expect(w.days).toHaveLength(7);
    expect([w.from, w.to, w.prev, w.next]).toEqual([
      "2027-01-11",
      "2027-01-17",
      "2027-01-08",
      "2027-01-22",
    ]);
    expect(w.title).toBe("Mon 11 Jan – Sun 17 Jan 2027");
  });

  it("is whole weeks around the month for the month view", () => {
    const m = viewRange("month", "2027-02-10");
    // Feb 2027 starts on a Monday and ends on a Sunday.
    expect([m.from, m.to, m.days.length]).toEqual([
      "2027-02-01",
      "2027-02-28",
      28,
    ]);
    const d = viewRange("month", "2026-12-24");
    expect([d.from, d.to, d.prev, d.next, d.month, d.title]).toEqual([
      "2026-11-30",
      "2027-01-03",
      "2026-11-01",
      "2027-01-01",
      "2026-12",
      "Dec 2026",
    ]);
  });
});

describe("parseViewParams", () => {
  it("reads a view and a date, or falls back to this week", () => {
    expect(
      parseViewParams({ view: "month", date: "2027-01-15" }, "2026-09-27"),
    ).toEqual({ view: "month", date: "2027-01-15" });
    expect(
      parseViewParams({ view: ["day", "week"], date: ["2027-01-15"] }, "x"),
    ).toEqual({ view: "day", date: "2027-01-15" });
    expect(
      parseViewParams({ view: "year", date: "2027-02-30" }, "2026-09-27"),
    ).toEqual({ view: "week", date: "2026-09-27" });
    expect(parseViewParams({}, "2026-09-27")).toEqual({
      view: "week",
      date: "2026-09-27",
    });
  });

  it("names each view", () => {
    expect(["day", "week", "month"].map((v) => viewLabel(v as never))).toEqual([
      "Day",
      "Week",
      "Month",
    ]);
  });
});
