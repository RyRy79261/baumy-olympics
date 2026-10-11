import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBER_COLORS } from "@baumy/types";
import type { NoteView } from "@/lib/actions/notes";
import { eventView } from "@/lib/calendar/view";
import {
  CELL_HEAD,
  CELL_PAD,
  CHIP_GAP,
  CHIP_H,
  HOUSE_COLOUR,
  addMonths,
  agoLabel,
  chipsFor,
  chipsThatFit,
  dayHeading,
  headerClock,
  longDay,
  monthCells,
  monthGridDays,
  monthTitle,
  parseMonthParams,
  unseenMessages,
  plannedLabel,
  sheetTime,
  whoOf,
  type DashboardMember,
} from "./dashboard";

// The kitchen dashboard's picks (ADR 0005, issue #65), on plain data.
// 15:42Z on Mon 28 Sep 2026 is 17:42 in Berlin (summer time), the
// prototype's "now".

const NOW = new Date("2026-09-28T15:42:00.000Z");
const HOUR = 3_600_000;
const at = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

const RYAN: DashboardMember = {
  id: "m-ryan",
  displayName: "Ryan",
  color: MEMBER_COLORS[5],
};
const JO: DashboardMember = {
  id: "m-jo",
  displayName: "Jo",
  color: MEMBER_COLORS[1],
};
const MEMBERS = [RYAN, JO];

describe("the house's colour", () => {
  it("is the kit's --color-bm-house, which no member colour offered uses", () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, "../../app/globals.css"),
      "utf8",
    );
    expect(css).toContain(`--color-bm-house: ${HOUSE_COLOUR};`);
    expect(MEMBER_COLORS).not.toContain(HOUSE_COLOUR);
  });
});

describe("members' colours", () => {
  it("finds who an event or note is from, else the house in amber", () => {
    expect(whoOf("m-ryan", MEMBERS)).toEqual({
      member: RYAN,
      name: "Ryan",
      colour: MEMBER_COLORS[5],
    });
    for (const id of [null, "m-gone"]) {
      expect(whoOf(id, MEMBERS)).toEqual({
        member: null,
        name: "House",
        colour: HOUSE_COLOUR,
      });
    }
  });
});

describe("the header", () => {
  it("says the Berlin day and time", () => {
    expect(headerClock(NOW)).toEqual({
      date: "Monday 28 September",
      time: "17:42",
    });
    // 23:30Z on the 28th is already Tuesday in Berlin.
    expect(headerClock(new Date("2026-09-28T23:30:00Z"))).toEqual({
      date: "Tuesday 29 September",
      time: "01:30",
    });
    expect(longDay("2027-01-03")).toBe("Sunday 3 January");
  });
});

describe("unseenMessages", () => {
  const everyone = [{ id: "m-jo" }, { id: "m-sam" }];

  function note(over: Partial<NoteView>): NoteView {
    return {
      id: over.title ?? "n",
      title: "n",
      bodyMd: "",
      color: null,
      pinned: false,
      authorId: "m-jo",
      authorName: "Jo",
      createdAt: at(-1),
      updatedAt: at(-1),
      editedAt: over.createdAt ?? at(-1),
      seenBy: ["m-jo"],
      ...over,
    };
  }

  it("keeps the notes not every member has seen, newest change first", () => {
    const rows = unseenMessages(
      [
        // Everyone has read it, however new: not a message any more.
        note({ title: "Read", createdAt: at(0), seenBy: ["m-jo", "m-sam"] }),
        note({ title: "Pasta", createdAt: at(-0.2) }),
        note({ title: "Wifi", createdAt: at(-40), editedAt: at(-3) }),
        note({ title: "Now", createdAt: at(0), seenBy: [] }),
        // Nearly 3 days old, and Sam has still not read it.
        note({ title: "Old", createdAt: at(-71) }),
        // Unread too, but 3 days old or more: never new (issue #194).
        note({ title: "Three days", createdAt: at(-72) }),
        note({ title: "Weeks", createdAt: at(-24 * 21) }),
        note({
          title: "Changed long ago",
          createdAt: at(-24 * 30),
          editedAt: at(-24 * 4),
        }),
      ],
      everyone,
      NOW,
    );
    expect(rows.map((r) => [r.title, r.when, r.seenBy])).toEqual([
      ["Now", "just now", []],
      ["Pasta", "12m ago", ["m-jo"]],
      ["Wifi", "changed 3h ago", ["m-jo"]],
      ["Old", "2d ago", ["m-jo"]],
    ]);
  });

  it("waits only for the members it is given", () => {
    const rows = unseenMessages(
      [note({ title: "Pasta" })],
      [{ id: "m-jo" }],
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("says how long ago", () => {
    expect(agoLabel(at(0), NOW)).toBe("now");
    expect(agoLabel(at(1), NOW)).toBe("now");
    expect(agoLabel(at(-0.5), NOW)).toBe("30m");
    expect(agoLabel(at(-23), NOW)).toBe("23h");
    expect(agoLabel(at(-24), NOW)).toBe("1d");
    expect(agoLabel(at(-49), NOW)).toBe("2d");
  });
});

describe("the month", () => {
  it("reads ?month and ?day, else this month and no day", () => {
    const today = "2026-09-28";
    expect(parseMonthParams({}, today)).toEqual({
      month: "2026-09",
      day: null,
    });
    expect(parseMonthParams({ month: "2026-13" }, today).month).toBe("2026-09");
    expect(parseMonthParams({ month: "Sept" }, today).month).toBe("2026-09");
    expect(
      parseMonthParams(
        { month: ["2026-10", "2026-11"], day: "2026-10-02" },
        today,
      ),
    ).toEqual({ month: "2026-10", day: "2026-10-02" });
    // A day in the grid's edge weeks is still in the grid.
    expect(
      parseMonthParams({ month: "2026-10", day: "2026-09-28" }, today).day,
    ).toBe("2026-09-28");
    for (const day of ["2026-12-25", "2026-02-30", "soon"]) {
      expect(parseMonthParams({ month: "2026-10", day }, today).day).toBeNull();
    }
  });

  it("lays a month out in whole weeks, Monday first", () => {
    const days = monthGridDays("2026-09");
    expect(days[0]).toBe("2026-08-31");
    expect(days.at(-1)).toBe("2026-10-04");
    expect(days).toHaveLength(35);
    // February 2021 starts on a Monday and fills exactly four weeks.
    expect(monthGridDays("2021-02")).toHaveLength(28);
  });

  it("steps months across years and names them", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", 0)).toBe("2026-09");
    expect(monthTitle("2026-09")).toBe("SEPTEMBER 2026");
  });

  it("marks each cell and puts each day's events in it", () => {
    const dinner = eventView({
      id: "dinner",
      title: "Dinner",
      description: null,
      location: null,
      allDay: false,
      start: "2026-09-28T17:30:00Z",
      end: "2026-09-28T20:00:00Z",
      member: "m-jo",
    });
    const trip = eventView({
      id: "trip",
      title: "Trip",
      description: null,
      location: null,
      allDay: true,
      start: "2026-10-03",
      end: "2026-10-05",
      member: null,
    });
    const cells = monthCells("2026-09", "2026-09-28", [trip, dinner]);
    const cell = (d: string) => cells.find((c) => c.day === d)!;
    expect(cell("2026-09-28")).toMatchObject({
      date: 28,
      inMonth: true,
      today: true,
      past: false,
      weekend: false,
    });
    expect(cell("2026-09-28").events.map((e) => e.id)).toEqual(["dinner"]);
    expect(cell("2026-09-27")).toMatchObject({ past: true, weekend: true });
    expect(cell("2026-08-31")).toMatchObject({ inMonth: false, past: true });
    expect(cell("2026-10-03").events.map((e) => e.id)).toEqual(["trip"]);
    expect(cell("2026-10-04").events.map((e) => e.id)).toEqual(["trip"]);
  });

  it("fits as many chips as the cell's height allows, at least one", () => {
    const one = CELL_PAD * 2 + CELL_HEAD + CHIP_H;
    expect(chipsThatFit(one)).toBe(1);
    expect(chipsThatFit(one + CHIP_GAP + CHIP_H)).toBe(2);
    expect(chipsThatFit(one + CHIP_GAP + CHIP_H - 1)).toBe(1);
    expect(chipsThatFit(10)).toBe(1);
  });

  it("shows every chip that fits, else one row fewer and +N more", () => {
    expect(chipsFor([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(chipsFor([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], more: 3 });
    expect(chipsFor([1, 2], 1)).toEqual({ shown: [], more: 2 });
  });
});

describe("the day sheet", () => {
  it("says Today, Tomorrow and Yesterday over the date, else the weekday", () => {
    const today = "2026-09-28";
    expect(dayHeading(today, today)).toEqual({
      over: "Today",
      title: "MONDAY 28 SEPTEMBER",
    });
    expect(dayHeading("2026-09-29", today).over).toBe("Tomorrow");
    expect(dayHeading("2026-09-27", today).over).toBe("Yesterday");
    expect(dayHeading("2026-10-02", today)).toEqual({
      over: "Friday",
      title: "2 OCTOBER",
    });
  });

  it("counts what is planned", () => {
    expect(plannedLabel(0, false)).toBe("");
    expect(plannedLabel(1, false)).toBe("1 thing planned");
    expect(plannedLabel(5, true)).toBe("5 things planned · done and dusted");
  });

  it("gives each event its time on that day", () => {
    const mk = (allDay: boolean, start: string, end: string) =>
      eventView({
        id: "e",
        title: "e",
        description: null,
        location: null,
        allDay,
        start,
        end,
        member: null,
      });
    const short = mk(false, "2026-10-02T05:30:00Z", "2026-10-02T06:00:00Z");
    expect(sheetTime(short, "2026-10-02")).toEqual({
      start: "07:30",
      end: "to 08:00",
    });
    // 19:00 until 02:00 the next night.
    const late = mk(false, "2026-10-02T17:00:00Z", "2026-10-03T00:00:00Z");
    expect(sheetTime(late, "2026-10-02")).toEqual({
      start: "19:00",
      end: "till late",
    });
    expect(sheetTime(late, "2026-10-03")).toEqual({
      start: "00:00",
      end: "to 02:00",
    });
    expect(
      sheetTime(mk(true, "2026-10-02", "2026-10-03"), "2026-10-02"),
    ).toEqual({
      start: "All day",
      end: "",
    });
  });
});
