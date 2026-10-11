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
    { name: "Toilet paper", kind: "consumable", isNew: false },
    { name: "Cat food", kind: "consumable", isNew: true },
    { name: "Bins", kind: "maintenance", isNew: true },
    { name: "Mop", kind: "maintenance", isNew: false },
  ] as const;
  const names = (f: (typeof BOUNTY_FILTERS)[number]) =>
    filterBounties(board, f).map((c) => c.name);

  it("keeps the new, or one kind", () => {
    expect(names("all")).toEqual(["Toilet paper", "Cat food", "Bins", "Mop"]);
    expect(names("new")).toEqual(["Cat food", "Bins"]);
    expect(names("consumable")).toEqual(["Toilet paper", "Cat food"]);
    expect(names("maintenance")).toEqual(["Bins", "Mop"]);
  });

  it("has no urgent tab any more (issue #189)", () => {
    expect(BOUNTY_FILTERS).toContain("new");
    expect(BOUNTY_FILTERS).not.toContain("urgent");
    expect(parseBountyFilter("urgent")).toBe("all");
  });

  it("counts what each tab keeps", () => {
    expect(bountyCounts(board)).toEqual({
      all: 4,
      new: 2,
      consumable: 2,
      maintenance: 2,
    });
  });

  it("reads ?show=, and anything unknown is all", () => {
    for (const f of BOUNTY_FILTERS) expect(parseBountyFilter(f)).toBe(f);
    expect(parseBountyFilter("errand")).toBe("all");
    expect(parseBountyFilter(undefined)).toBe("all");
    expect(parseBountyFilter(["new"])).toBe("all");
  });
});

describe("sortBounties", () => {
  it("puts the ready first by name, then the soonest ready again, unscorable last", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 28, h)).toISOString();
    const sorted = sortBounties([
      { name: "Keller", state: "unavailable", availableAt: null },
      { name: "Mop", state: "ready", availableAt: null },
      { name: "Laundry", state: "cooldown", availableAt: at(20) },
      { name: "Dishes", state: "cooldown", availableAt: at(8) },
      { name: "Trash", state: "ready", availableAt: null },
      { name: "Bins", state: "cooldown", availableAt: at(8) },
      { name: "Apples", state: "ready", availableAt: null },
    ]);
    expect(sorted.map((c) => c.name)).toEqual([
      "Apples",
      "Mop",
      "Trash",
      "Bins",
      "Dishes",
      "Laundry",
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
  const base = { archived: false, availableAt: null };
  it("says Ready, or Again from a time in Berlin; never a due date", () => {
    expect(statusLabel({ ...base, state: "ready" })).toBe("Ready");
    expect(
      statusLabel({
        ...base,
        state: "cooldown",
        availableAt: "2026-09-30T06:00:00.000Z",
      }),
    ).toBe("Again from Wed 30 Sep, 08:00");
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
    streak: { holderId: "ryan", holderName: "Ryan", length: 3 },
  };

  it("extends the holder's own streak", () => {
    expect(previewFor(trash, "ryan")).toEqual({
      headline: "+35, streak 4",
      totalPts: 35,
      breaks: null,
    });
  });

  it("names the streak it breaks and the bonus", () => {
    expect(previewFor(trash, "partner")).toEqual({
      headline: "+32, streak 1",
      totalPts: 32,
      breaks: "Breaks Ryan's streak of 3: +12 bonus",
    });
  });

  it("has nothing to preview without points", () => {
    expect(previewFor({ ...trash, basePoints: null }, "ryan")).toBeNull();
  });
});
