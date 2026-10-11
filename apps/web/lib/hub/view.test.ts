import { describe, expect, it } from "vitest";
import type { ChoreView } from "@/lib/actions/list-chores";
import { eventView } from "@/lib/calendar/view";
import {
  HUB_EVENTS,
  agendaTime,
  clockLines,
  readyChores,
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

/** A chore as list_chores returns it. */
function chore(over: Partial<ChoreView>): ChoreView {
  return {
    id: over.name ?? "c",
    name: "c",
    sprite: "broom",
    kind: "maintenance",
    proofMode: "none",
    effortFactorPct: 100,
    archived: false,
    basePoints: 10,
    cooldownMinutes: 60,
    streak: null,
    lastDoneAt: null,
    state: "ready",
    availableAt: null,
    isNew: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    next: null,
    ...over,
  };
}

describe("readyChores", () => {
  it("lists the bounties ready to log, by name", () => {
    const list = readyChores([
      chore({ name: "Mop", lastDoneAt: iso(-24 * 40) }),
      chore({ name: "Cooling", state: "cooldown", availableAt: iso(2) }),
      chore({ name: "Archived", state: "unavailable", archived: true }),
      chore({
        name: "Bins",
        streak: { holderId: "m", holderName: "Ryan", length: 3 },
      }),
    ]);
    expect(list.map((c) => c.name)).toEqual(["Bins", "Mop"]);
    expect(list[0]).toMatchObject({ streak: "Ryan · streak 3" });
    // Done 40 days ago is still only ready: there is no due date or
    // overdue any more (issue #189).
    expect(list[1]).toMatchObject({ streak: "No streak yet" });
    expect(list[1]).not.toHaveProperty("overdue");
    expect(list[1]).not.toHaveProperty("when");
  });

  it("carries each bounty's glyph, kind, New mark and points", () => {
    const [cat] = readyChores([
      chore({
        name: "Cat food",
        sprite: "catfood",
        kind: "consumable",
        isNew: true,
        basePoints: 20,
      }),
    ]);
    expect(cat).toMatchObject({
      sprite: "catfood",
      kind: "consumable",
      isNew: true,
      points: 20,
    });
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
