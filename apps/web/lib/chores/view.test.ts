import { describe, expect, it } from "vitest";
import {
  BOUNTY_FILTERS,
  bountyCounts,
  filterBounties,
  parseBountyFilter,
  previewFor,
  sortBounties,
  statusLabel,
  streakLabel,
} from "./view";

describe("bounty filters", () => {
  const board = [
    { name: "Toilet paper", kind: "consumable", urgent: true, isNew: false },
    { name: "Cat food", kind: "consumable", urgent: false, isNew: true },
    { name: "Bins", kind: "maintenance", urgent: true, isNew: true },
    { name: "Mop", kind: "maintenance", urgent: false, isNew: false },
  ] as const;
  const names = (f: (typeof BOUNTY_FILTERS)[number]) =>
    filterBounties(board, f).map((c) => c.name);

  it("keeps the urgent, the new, or one kind", () => {
    expect(names("all")).toEqual(["Toilet paper", "Cat food", "Bins", "Mop"]);
    expect(names("urgent")).toEqual(["Toilet paper", "Bins"]);
    expect(names("new")).toEqual(["Cat food", "Bins"]);
    expect(names("consumable")).toEqual(["Toilet paper", "Cat food"]);
    expect(names("maintenance")).toEqual(["Bins", "Mop"]);
  });

  it("counts what each tab keeps", () => {
    expect(bountyCounts(board)).toEqual({
      all: 4,
      urgent: 2,
      new: 2,
      consumable: 2,
      maintenance: 2,
    });
  });

  it("reads ?show=, and anything unknown is all", () => {
    for (const f of BOUNTY_FILTERS) expect(parseBountyFilter(f)).toBe(f);
    expect(parseBountyFilter("errand")).toBe("all");
    expect(parseBountyFilter(undefined)).toBe("all");
    expect(parseBountyFilter(["urgent"])).toBe("all");
  });
});

describe("sortBounties", () => {
  it("puts the urgent first, oldest due at the top, unscorable last", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 28, h)).toISOString();
    const sorted = sortBounties([
      { name: "Keller", urgent: false, state: "unavailable", dueAt: null },
      { name: "Mop", urgent: false, state: "done", dueAt: at(30) },
      { name: "Laundry", urgent: false, state: "cooldown", dueAt: at(20) },
      { name: "Dishes", urgent: true, state: "due", dueAt: at(8) },
      { name: "Trash", urgent: true, state: "due", dueAt: null },
      { name: "Bins", urgent: true, state: "done", dueAt: at(18) },
      { name: "Apples", urgent: true, state: "done", dueAt: at(18) },
    ]);
    expect(sorted.map((c) => c.name)).toEqual([
      "Trash",
      "Dishes",
      "Apples",
      "Bins",
      "Laundry",
      "Mop",
      "Keller",
    ]);
  });
});

describe("streakLabel", () => {
  it("names the holder and the length", () => {
    expect(
      streakLabel({ streak: { holderId: "r", holderName: "Ryan", length: 3 } }),
    ).toBe("Ryan · streak 3");
    expect(streakLabel({ streak: null })).toBe("No streak yet");
  });
});

describe("statusLabel", () => {
  const base = { archived: false, availableAt: null, dueAt: null };
  it("says when, in Berlin time", () => {
    expect(statusLabel({ ...base, state: "due" })).toBe("Never done");
    expect(
      statusLabel({ ...base, state: "due", dueAt: "2026-09-30T06:00:00.000Z" }),
    ).toBe("Due since Wed 30 Sep, 08:00");
    expect(
      statusLabel({
        ...base,
        state: "cooldown",
        availableAt: "2026-09-30T06:00:00.000Z",
      }),
    ).toBe("Again from Wed 30 Sep, 08:00");
    expect(
      statusLabel({
        ...base,
        state: "done",
        dueAt: "2026-10-01T06:00:00.000Z",
      }),
    ).toBe("Due Thu 1 Oct, 08:00");
    expect(statusLabel({ ...base, state: "unavailable" })).toBe(
      "No points set yet",
    );
    expect(statusLabel({ ...base, state: "unavailable", archived: true })).toBe(
      "Archived",
    );
  });
});

describe("previewFor", () => {
  const trash = {
    basePoints: 20,
    confirmMode: "optimistic" as const,
    streak: { holderId: "ryan", holderName: "Ryan", length: 3 },
  };

  it("extends the holder's own streak", () => {
    expect(previewFor(trash, "ryan", "ryan")).toEqual({
      headline: "+35, streak 4",
      totalPts: 35,
      breaks: null,
      pending: null,
    });
  });

  it("names the streak it breaks and the bonus", () => {
    expect(previewFor(trash, "partner", "ryan")).toEqual({
      headline: "+32, streak 1",
      totalPts: 32,
      breaks: "Breaks Ryan's streak of 3: +12 bonus",
      pending: null,
    });
  });

  it("warns that a partner-mode self-claim waits, but not a vouched one", () => {
    const partnerMode = {
      ...trash,
      confirmMode: "partner" as const,
      streak: null,
    };
    expect(previewFor(partnerMode, "ryan", "ryan")?.pending).toBe(
      "Counts once someone else confirms it.",
    );
    expect(previewFor(partnerMode, "partner", "ryan")?.pending).toBeNull();
  });

  it("has nothing to preview without points", () => {
    expect(
      previewFor({ ...trash, basePoints: null }, "ryan", "ryan"),
    ).toBeNull();
  });
});
