import { describe, expect, it } from "vitest";
import type { ChoreView } from "@/lib/actions/list-chores";
import { isUrgent } from "@/lib/chores/urgency";
import { eventView } from "@/lib/calendar/view";
import {
  HUB_EVENTS,
  MESSAGES_WINDOW_MS,
  agendaTime,
  OVERDUE_AFTER_MS,
  clockLines,
  dueChores,
  recentNoteCount,
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

/** A chore as list_chores returns it: `urgent` is computed the same way. */
function chore(over: Partial<ChoreView>): ChoreView {
  const c: ChoreView = {
    id: over.name ?? "c",
    name: "c",
    sprite: "broom",
    kind: "maintenance",
    proofMode: "none",
    confirmMode: "optimistic",
    effortFactorPct: 100,
    archived: false,
    basePoints: 10,
    cooldownMinutes: 60,
    intervalMinutes: 1440,
    streak: null,
    lastDoneAt: null,
    state: "due",
    availableAt: null,
    dueAt: null,
    urgent: false,
    isNew: false,
    next: null,
    ...over,
  };
  return { ...c, urgent: over.urgent ?? isUrgent(c, NOW) };
}

describe("dueChores", () => {
  it("lists never-done first, then the longest due, then later today", () => {
    const list = dueChores(
      [
        chore({ name: "Soon", state: "done", dueAt: iso(3) }),
        chore({ name: "Tomorrow", state: "done", dueAt: iso(20) }),
        chore({ name: "Cooling", state: "cooldown", dueAt: iso(2) }),
        chore({ name: "Recent", dueAt: iso(-1) }),
        chore({ name: "Ancient", dueAt: iso(-48) }),
        chore({ name: "Never" }),
        chore({ name: "Archived", state: "unavailable", dueAt: iso(1) }),
        chore({
          name: "Streaky",
          dueAt: iso(-1),
          streak: { holderId: "m", holderName: "Ryan", length: 3 },
        }),
      ],
      NOW,
    );
    expect(list.map((c) => c.name)).toEqual([
      "Never",
      "Ancient",
      "Recent",
      "Streaky",
      "Cooling",
      "Soon",
    ]);
    expect(list[0]).toMatchObject({ when: "Never done", overdue: false });
    expect(list[1]).toMatchObject({
      when: "Due since Fri 25 Sep, 12:00",
      overdue: true,
    });
    expect(list[2]).toMatchObject({ overdue: false, streak: "No streak yet" });
    expect(list[3]!.streak).toBe("Ryan · streak 3");
    expect(list[4]).toMatchObject({ when: "Due at 14:00", overdue: false });
    expect(list[5]!.when).toBe("Due at 15:00");
  });

  it("lists a chore that is not due yet exactly when list_chores calls it urgent", () => {
    const soon = { name: "Soon", state: "done", dueAt: iso(3) } as const;
    expect(dueChores([chore(soon)], NOW).map((c) => c.name)).toEqual(["Soon"]);
    expect(dueChores([chore({ ...soon, urgent: false })], NOW)).toEqual([]);
  });

  it("carries each bounty's glyph, kind, New mark and points", () => {
    const [cat] = dueChores(
      [
        chore({
          name: "Cat food",
          sprite: "catfood",
          kind: "consumable",
          isNew: true,
          basePoints: 20,
        }),
      ],
      NOW,
    );
    expect(cat).toMatchObject({
      sprite: "catfood",
      kind: "consumable",
      isNew: true,
      points: 20,
    });
  });

  it("calls a chore overdue after a day of being due", () => {
    const at = (ms: number) =>
      dueChores(
        [chore({ dueAt: new Date(NOW.getTime() - ms).toISOString() })],
        NOW,
      )[0]!.overdue;
    expect(at(OVERDUE_AFTER_MS - 1)).toBe(false);
    expect(at(OVERDUE_AFTER_MS)).toBe(true);
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

describe("recentNoteCount", () => {
  it("counts the notes created or changed in the last 24 hours", () => {
    const ago = (ms: number) => ({
      updatedAt: new Date(NOW.getTime() - ms).toISOString(),
    });
    expect(
      recentNoteCount(
        [
          ago(0),
          ago(HOUR),
          ago(MESSAGES_WINDOW_MS - 1),
          ago(MESSAGES_WINDOW_MS),
        ],
        NOW,
      ),
    ).toBe(3);
    expect(recentNoteCount([], NOW)).toBe(0);
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
