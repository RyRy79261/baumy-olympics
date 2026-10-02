import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBER_COLORS } from "@baumy/types";
import type { ChoreView } from "@/lib/actions/list-chores";
import { NOTE_RECENT_MS, type NoteView } from "@/lib/actions/notes";
import { eventView } from "@/lib/calendar/view";
import {
  CELL_HEAD,
  CELL_PAD,
  CHIP_GAP,
  CHIP_H,
  HOUSE_COLOUR,
  MESSAGES_WINDOW_MS,
  addMonths,
  agoLabel,
  bountyRows,
  bountyTabCounts,
  chipsFor,
  chipsThatFit,
  dayHeading,
  dueLabel,
  headerClock,
  inTab,
  isNewBounty,
  isUrgentBounty,
  kindLabel,
  longDay,
  monthCells,
  monthGridDays,
  monthTitle,
  parseMonthParams,
  plannedLabel,
  recentMessages,
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

function chore(over: Partial<ChoreView>): ChoreView {
  return {
    id: over.name ?? "c",
    name: "c",
    sprite: "bin",
    kind: "maintenance",
    proofMode: "none",
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
    createdAt: at(-200),
    next: null,
    ...over,
  };
}

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

describe("dueLabel", () => {
  it("says never done, and no points yet for a chore without a weight", () => {
    expect(dueLabel(chore({ state: "due", dueAt: null }), NOW)).toEqual({
      text: "Never done",
      tone: "later",
    });
    expect(dueLabel(chore({ state: "unavailable", dueAt: null }), NOW)).toEqual(
      { text: "No points yet", tone: "later" },
    );
  });

  it("says how late a due bounty is, in hours then days", () => {
    expect(dueLabel(chore({ state: "due", dueAt: at(-0.5) }), NOW)).toEqual({
      text: "Due now",
      tone: "late",
    });
    expect(dueLabel(chore({ state: "due", dueAt: at(-20) }), NOW)).toEqual({
      text: "20h late",
      tone: "late",
    });
    expect(dueLabel(chore({ state: "due", dueAt: at(-50) }), NOW)).toEqual({
      text: "2d late",
      tone: "late",
    });
  });

  it("says how soon the rest fall due, amber within 12 hours", () => {
    const due = (h: number) =>
      dueLabel(chore({ state: "done", dueAt: at(h) }), NOW);
    expect(due(0.25)).toEqual({ text: "in 15m", tone: "soon" });
    expect(due(0.001)).toEqual({ text: "in 1m", tone: "soon" });
    expect(due(5)).toEqual({ text: "in 5h", tone: "soon" });
    expect(due(12)).toEqual({ text: "in 12h", tone: "soon" });
    expect(due(30)).toEqual({ text: "in 30h", tone: "later" });
    expect(due(72)).toEqual({ text: "in 3 days", tone: "later" });
    // A deadline that has just passed counts as late whatever the state.
    expect(due(-2)).toEqual({ text: "2h late", tone: "late" });
  });
});

describe("bountyRows", () => {
  const chores = [
    chore({ name: "Later", state: "done", dueAt: at(30) }),
    chore({
      name: "Bins",
      state: "due",
      dueAt: at(-3),
      urgent: true,
      streak: { holderId: "m-ryan", holderName: "Ryan", length: 6 },
    }),
    chore({
      name: "Cat food",
      kind: "consumable",
      state: "cooldown",
      dueAt: at(5),
      urgent: true,
      isNew: true,
      streak: { holderId: "m-gone", holderName: "Kim", length: 2 },
      next: {
        totalPts: 23,
        streakLen: 1,
        streakPts: 0,
        breakPts: 3,
        brokenMemberId: "m-gone",
        brokenLen: 2,
      },
    }),
    chore({ name: "Never", state: "due", urgent: true }),
    chore({ name: "Archived", archived: true, urgent: true }),
    chore({ name: "Unweighted", state: "unavailable", isNew: true }),
  ];

  it("lists the loggable ones picked, soonest due first", () => {
    const rows = bountyRows(chores, isUrgentBounty, MEMBERS, NOW);
    expect(rows.map((r) => r.name)).toEqual(["Never", "Bins", "Cat food"]);
    expect(rows[1]).toEqual({
      id: "Bins",
      name: "Bins",
      sprite: "bin",
      kind: "maintenance",
      isNew: false,
      points: 10,
      due: { text: "3h late", tone: "late" },
      streak: {
        holderId: "m-ryan",
        holderName: "Ryan",
        length: 6,
        colour: MEMBER_COLORS[5],
      },
      loggable: true,
    });
    // What you would score, once someone is asking; the holder's colour
    // falls back to the house's for someone who left.
    expect(rows[2]).toMatchObject({
      points: 23,
      loggable: false,
      streak: { holderName: "Kim", colour: HOUSE_COLOUR },
    });
  });

  it("picks every new one, one without a weight last and not loggable", () => {
    const rows = bountyRows(chores, isNewBounty, MEMBERS, NOW);
    expect(rows.map((r) => r.name)).toEqual(["Cat food", "Unweighted"]);
    // Exactly list_chores' isNew, so the icon's count is the list's.
    expect(rows).toHaveLength(chores.filter((c) => c.isNew).length);
    expect(rows[1]).toMatchObject({
      loggable: false,
      due: { text: "No points yet" },
    });
  });

  it("sorts a never-done chore by when it was added, under real lateness", () => {
    const rows = bountyRows(
      [
        chore({ name: "Fresh", state: "due", createdAt: at(-1) }),
        chore({ name: "Bins", state: "due", dueAt: at(-3) }),
        chore({ name: "Ancient", state: "due", createdAt: at(-72) }),
      ],
      () => true,
      MEMBERS,
      NOW,
    );
    expect(rows.map((r) => r.name)).toEqual(["Ancient", "Bins", "Fresh"]);
  });

  it("breaks a tie on the deadline by name", () => {
    const same = [
      chore({ name: "B", dueAt: at(-1) }),
      chore({ name: "A", dueAt: at(-1) }),
    ];
    expect(
      bountyRows(same, () => true, MEMBERS, NOW).map((r) => r.name),
    ).toEqual(["A", "B"]);
  });

  it("counts and filters the tabs by kind", () => {
    const rows = bountyRows(chores, isUrgentBounty, MEMBERS, NOW);
    expect(bountyTabCounts(rows)).toEqual({
      all: 3,
      consumable: 1,
      maintenance: 2,
    });
    expect(
      rows.filter((r) => inTab(r, "consumable")).map((r) => r.name),
    ).toEqual(["Cat food"]);
    expect(rows.filter((r) => inTab(r, "all"))).toHaveLength(3);
    expect(kindLabel("consumable")).toBe("Consumable");
    expect(kindLabel("maintenance")).toBe("Maintenance");
  });
});

describe("recentMessages", () => {
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
      ...over,
    };
  }

  it("keeps the notes added or edited in the last day, newest first", () => {
    const window = MESSAGES_WINDOW_MS / HOUR;
    const rows = recentMessages(
      [
        note({ title: "Old", createdAt: at(-30), editedAt: at(-window) }),
        note({ title: "Pasta", createdAt: at(-0.2) }),
        note({ title: "Wifi", createdAt: at(-40), editedAt: at(-3) }),
        note({ title: "Now", createdAt: at(0) }),
        // Pinned an hour ago: a change, but not an edit, so not a message.
        note({
          title: "Pinned",
          createdAt: at(-40),
          updatedAt: at(-1),
          pinned: true,
        }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.title, r.when])).toEqual([
      ["Now", "just now"],
      ["Pasta", "12m ago"],
      ["Wifi", "changed 3h ago"],
    ]);
  });

  it("looks back as far as list_notes' recentCount does", () => {
    expect(MESSAGES_WINDOW_MS).toBe(NOTE_RECENT_MS);
  });

  it("says how long ago", () => {
    expect(agoLabel(at(0), NOW)).toBe("now");
    expect(agoLabel(at(1), NOW)).toBe("now");
    expect(agoLabel(at(-0.5), NOW)).toBe("30m");
    expect(agoLabel(at(-23), NOW)).toBe("23h");
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
