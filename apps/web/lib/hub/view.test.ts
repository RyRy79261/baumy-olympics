import { describe, expect, it } from "vitest";
import { eventView } from "@/lib/calendar/view";
import {
  HUB_EVENTS,
  agendaTime,
  clockLines,
  upcomingEvents,
  widgetState,
} from "./view";

// The hub's picks (issue #20), on plain data. 10:00Z on 27 Sep 2026 is 12:00
// in Berlin (summer time).

const NOW = new Date("2026-09-27T10:00:00.000Z");
const HOUR = 3_600_000;
const iso = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

function timed(id: string, from: number, to: number) {
  return eventView({
    id,
    title: id,
    description: null,
    location: id === "lunch" ? "Kitchen" : null,
    allDay: false,
    start: iso(from),
    end: iso(to),
    member: id === "lunch" ? "m1" : null,
  });
}
function allDay(id: string, start: string, end: string) {
  return eventView({
    id,
    title: id,
    description: null,
    location: null,
    allDay: true,
    start,
    end,
    member: null,
  });
}

describe("widgetState", () => {
  const pick = (d: { items: number[] }) => d.items;
  it("is ready with items, empty without, unavailable on a failure", () => {
    expect(
      widgetState({ ok: true, data: { items: [1] } }, pick, "None"),
    ).toEqual({ status: "ready", data: [1] });
    expect(
      widgetState({ ok: true, data: { items: [] } }, pick, "None"),
    ).toEqual({ status: "empty", message: "None" });
    expect(
      widgetState(
        { ok: false, code: "NOT_CONFIGURED", message: "Not connected yet." },
        pick,
        "None",
      ),
    ).toEqual({ status: "unavailable", message: "Not connected yet." });
  });
});

describe("upcomingEvents", () => {
  it("leaves out what has ended and says each one's time today", () => {
    const events = [
      allDay("bins", "2026-09-27", "2026-09-28"),
      allDay("trip", "2026-09-25", "2026-09-28"),
      timed("breakfast", -3, -2),
      timed("lunch", -0.5, 1),
      timed("late", 11, 14),
      timed("dinner", 7, 8),
    ];
    expect(upcomingEvents(events, NOW)).toEqual([
      {
        id: "bins",
        title: "bins",
        time: "All day",
        location: null,
        addedBy: null,
      },
      {
        id: "trip",
        title: "trip",
        time: "All day",
        location: null,
        addedBy: null,
      },
      {
        id: "lunch",
        title: "lunch",
        time: "11:30–13:00",
        location: "Kitchen",
        addedBy: "m1",
      },
      {
        id: "late",
        title: "late",
        time: "From 23:00",
        location: null,
        addedBy: null,
      },
      {
        id: "dinner",
        title: "dinner",
        time: "19:00–20:00",
        location: null,
        addedBy: null,
      },
    ]);
  });

  it("says Until for one that started yesterday, and All day through today", () => {
    const events = [timed("night", -14, 1), timed("long", -30, 30)];
    expect(upcomingEvents(events, NOW).map((e) => e.time)).toEqual([
      "Until 13:00",
      "All day",
    ]);
  });

  it("lists at most five", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      timed(`e${i}`, i + 1, i + 2),
    );
    expect(upcomingEvents(many, NOW)).toHaveLength(HUB_EVENTS);
  });
});

describe("clockLines", () => {
  it("reads Berlin time", () => {
    expect(clockLines(NOW)).toEqual({ time: "12:00", date: "Sun 27 Sep" });
    expect(clockLines(new Date("2027-01-15T18:05:00Z"))).toEqual({
      time: "19:05",
      date: "Fri 15 Jan",
    });
  });
});

describe("agendaTime", () => {
  it("splits the start from the end", () => {
    expect(agendaTime("19:00–20:30")).toEqual({
      time: "19:00",
      until: "to 20:30",
    });
    expect(agendaTime("Until 11:00")).toEqual({
      time: "Now",
      until: "to 11:00",
    });
    expect(agendaTime("From 22:00")).toEqual({
      time: "22:00",
      until: "till late",
    });
    expect(agendaTime("All day")).toEqual({ time: "All day" });
  });
});
