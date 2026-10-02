import { describe, expect, it } from "vitest";
import { LIST_EVENTS_MAX_DAYS } from "@baumy/types";
import {
  hasEnded,
  upcomingGroups,
  upcomingRange,
  upcomingTime,
} from "./upcoming";
import { eventView, type EventLike } from "./view";

// The kiosk calendar manager's list (issue #134): what is still to come,
// in Today, This week and Later.

/** Wednesday 13 Jan 2027, 12:00 in Berlin (UTC+1). */
const NOW = new Date("2027-01-13T11:00:00.000Z");

function timed(id: string, start: string, end: string): EventLike {
  return {
    id,
    title: id,
    description: null,
    location: null,
    allDay: false,
    start,
    end,
    member: null,
  };
}

function allDay(id: string, first: string, dayAfterLast: string): EventLike {
  return { ...timed(id, first, dayAfterLast), allDay: true };
}

const events = [
  // Later: a Monday, and three days in February.
  timed("monday", "2027-01-18T18:00:00.000Z", "2027-01-18T19:00:00.000Z"),
  allDay("feb", "2027-02-01", "2027-02-04"),
  // This week: Thursday all day, and Sunday evening.
  allDay("thursday", "2027-01-14", "2027-01-15"),
  timed("sunday", "2027-01-17T18:00:00.000Z", "2027-01-17T20:00:00.000Z"),
  // Today: later on, past midnight, since last night, and two days long.
  timed("dinner", "2027-01-13T18:00:00.000Z", "2027-01-13T19:30:00.000Z"),
  timed("party", "2027-01-13T22:00:00.000Z", "2027-01-14T00:30:00.000Z"),
  timed("night", "2027-01-12T21:00:00.000Z", "2027-01-13T12:00:00.000Z"),
  allDay("visit", "2027-01-12", "2027-01-14"),
  // Over: this morning, and yesterday all day.
  timed("breakfast", "2027-01-13T07:00:00.000Z", "2027-01-13T08:00:00.000Z"),
  allDay("yesterday", "2027-01-12", "2027-01-13"),
].map(eventView);

const ids = (g: { events: { id: string }[] }) => g.events.map((e) => e.id);

describe("upcomingRange", () => {
  it("reads today and as far ahead as list_events allows", () => {
    expect(upcomingRange("2027-01-13")).toEqual({
      from: "2027-01-13",
      to: "2027-03-16",
    });
    expect(LIST_EVENTS_MAX_DAYS).toBe(62);
  });
});

describe("hasEnded", () => {
  it("ends a timed event at its end, and an all-day one after its last day", () => {
    expect(
      hasEnded(
        eventView(timed("b", "2027-01-13T07:00:00Z", NOW.toISOString())),
        NOW,
      ),
    ).toBe(true);
    expect(
      hasEnded(
        eventView(timed("b", "2027-01-13T07:00:00Z", "2027-01-13T11:01:00Z")),
        NOW,
      ),
    ).toBe(false);
    expect(
      hasEnded(eventView(allDay("a", "2027-01-13", "2027-01-14")), NOW),
    ).toBe(false);
    expect(
      hasEnded(eventView(allDay("a", "2027-01-12", "2027-01-13")), NOW),
    ).toBe(true);
  });
});

describe("upcomingGroups", () => {
  it("groups what is still to come into today, this week and later, soonest first", () => {
    const [today, week, later] = upcomingGroups(events, NOW);
    expect(today).toMatchObject({ key: "today", title: "Today" });
    expect(ids(today!)).toEqual(["visit", "night", "dinner", "party"]);
    expect(week).toMatchObject({ key: "week", title: "This week" });
    expect(ids(week!)).toEqual(["thursday", "sunday"]);
    expect(later).toMatchObject({ key: "later", title: "Later" });
    expect(ids(later!)).toEqual(["monday", "feb"]);
  });

  it("puts all-day events first on their day, then by title", () => {
    const sameDay = [
      timed("b-midnight", "2027-01-14T23:00:00.000Z", "2027-01-15T00:00:00Z"),
      allDay("z-all-day", "2027-01-15", "2027-01-16"),
      allDay("a-all-day", "2027-01-15", "2027-01-16"),
    ].map(eventView);
    expect(ids(upcomingGroups(sameDay, NOW)[1]!)).toEqual([
      "a-all-day",
      "z-all-day",
      "b-midnight",
    ]);
  });

  it("says what each empty group means", () => {
    const groups = upcomingGroups([], NOW);
    expect(groups.map((g) => g.empty)).toEqual([
      "Nothing else today.",
      "Nothing else this week.",
      "Nothing planned up to Tue 16 Mar.",
    ]);
    // On a Sunday the week ends today, and Monday is later.
    const sunday = new Date("2027-01-17T10:00:00.000Z");
    const onSunday = upcomingGroups(events, sunday);
    expect(onSunday[1]).toMatchObject({
      events: [],
      empty: "The week ends today.",
    });
    expect(ids(onSunday[0]!)).toEqual(["sunday"]);
    expect(ids(onSunday[2]!)).toEqual(["monday", "feb"]);
  });
});

describe("upcomingTime", () => {
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  const today = "2027-01-13";

  it("shows today's events by time, as the day sheet does", () => {
    expect(upcomingTime(byId.dinner!, "today", today)).toEqual({
      start: "19:00",
      end: "to 20:30",
    });
    expect(upcomingTime(byId.party!, "today", today)).toEqual({
      start: "23:00",
      end: "till late",
    });
    expect(upcomingTime(byId.night!, "today", today)).toEqual({
      start: "Now",
      end: "to 13:00",
    });
    expect(upcomingTime(byId.visit!, "today", today)).toEqual({
      start: "All day",
      end: "",
    });
  });

  it("shows another day's events by their day, then their time", () => {
    expect(upcomingTime(byId.sunday!, "week", today)).toEqual({
      start: "Sun 17 Jan",
      end: "19:00–21:00",
    });
    expect(upcomingTime(byId.thursday!, "week", today)).toEqual({
      start: "Thu 14 Jan",
      end: "All day",
    });
    expect(upcomingTime(byId.feb!, "later", today)).toEqual({
      start: "Mon 1 Feb",
      end: "to Wed 3 Feb",
    });
    const overnight = eventView(
      timed("o", "2027-01-20T21:00:00.000Z", "2027-01-21T09:00:00.000Z"),
    );
    expect(upcomingTime(overnight, "later", today)).toEqual({
      start: "Wed 20 Jan",
      end: "22:00 to Thu 21 Jan",
    });
  });
});
