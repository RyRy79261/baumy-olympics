import { describe, expect, it } from "vitest";
import { previewFor, statusLabel, streakLabel } from "./view";

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
    expect(statusLabel({ ...base, state: "due" })).toBe("Due");
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
