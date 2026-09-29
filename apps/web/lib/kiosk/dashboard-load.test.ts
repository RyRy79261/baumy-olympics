// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { useTestDb } from "@baumy/db/test-harness";
import { members } from "@baumy/db/schema";
import { eq } from "drizzle-orm";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { runAction } from "@/lib/actions/registry";
import {
  setCalendarClientForTests,
  unconfiguredCalendar,
} from "@/lib/integrations/calendar";
import type {
  CalendarClient,
  TimeRange,
} from "@/lib/integrations/google-calendar";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { loadDashboard } from "./dashboard-load";

// The kitchen dashboard's reads through the real runAction on PGlite
// (issue #65), as the paired device before anyone taps in: the chores, the
// whole month grid's events, the notes and the members' characters, and one
// failing read (the calendar down, or throwing) leaves the others alone.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const kioskCtx = () => ctxFor(kioskActor(), { source: "kiosk" });

let ryan: string;
let asked: TimeRange[];

beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), { displayName: "Ryan" });
  asked = [];
  setCalendarClientForTests({
    ...unconfiguredCalendar,
    list: async (q) => {
      asked.push(q);
      return {
        ok: true,
        data: [
          {
            id: "flea",
            title: "Flea market",
            description: null,
            location: null,
            allDay: false,
            start: "2026-10-03T08:00:00Z",
            end: "2026-10-03T10:00:00Z",
            private: false,
            member: ryan,
          },
          {
            id: "secret",
            title: "Secret",
            description: null,
            location: null,
            allDay: true,
            start: "2026-10-01",
            end: "2026-10-02",
            private: true,
            member: null,
          },
        ],
      };
    },
  } satisfies CalendarClient);
});

afterEach(() => {
  setCalendarClientForTests(null);
  vi.restoreAllMocks();
});

describe("loadDashboard", () => {
  it("reads the chores, the month's events, the notes and the members", async () => {
    await seedChore(db(), SEED_CHORES.trash);
    await runAction(
      "create_note",
      { title: "Pasta", bodyMd: "Who ate it?" },
      ctxFor(sessionActor(ryan)),
    );
    const character = {
      hairStyle: "bob",
      hairColor: "black",
      skinTone: "tan",
      shirtColor: "violet",
    };
    await t
      .db()
      .update(members)
      .set({ avatar: character })
      .where(eq(members.id, ryan));

    const data = await loadDashboard(kioskCtx(), "2026-10", db());
    expect(data.now).toBe(FIXED_NOW.toISOString());
    expect(data.today).toBe("2026-09-27");
    expect(data.month).toBe("2026-10");
    // October 2026's grid: Mon 28 Sep to Sun 1 Nov, in Berlin days.
    expect(asked).toEqual([
      {
        timeMin: new Date("2026-09-27T22:00:00.000Z"),
        timeMax: new Date("2026-11-01T23:00:00.000Z"),
      },
    ]);
    expect(data.events).toMatchObject({
      ok: true,
      data: [{ id: "flea", title: "Flea market", addedBy: ryan }],
    });
    expect(data.events.ok && data.events.data).toHaveLength(1);
    expect(data.chores).toMatchObject({
      ok: true,
      data: [{ name: SEED_CHORES.trash.name, state: "due", next: null }],
    });
    expect(data.notes).toMatchObject({
      ok: true,
      data: { notes: [{ title: "Pasta", authorId: ryan }], recentCount: 1 },
    });
    expect(data.members).toEqual([
      { id: ryan, displayName: "Ryan", avatar: character, sprites: null },
    ]);
  });

  it("gives members who have not chosen a character shirts of their own", async () => {
    const more = [
      await seedMember(db(), { displayName: "Jo" }),
      await seedMember(db(), { displayName: "Sam" }),
      await seedMember(db(), { displayName: "Mika" }),
    ];
    const data = await loadDashboard(kioskCtx(), "2026-09", db());
    expect(data.members.map((m) => m.id).sort()).toEqual(
      [ryan, ...more].sort(),
    );
    const shirts = data.members.map(
      (m) => (m.avatar as { shirtColor: string }).shirtColor,
    );
    expect(new Set(shirts).size).toBe(4);
  });

  it("says the calendar is not connected, and reads everything else", async () => {
    await seedChore(db(), SEED_CHORES.trash);
    setCalendarClientForTests(unconfiguredCalendar);
    const data = await loadDashboard(kioskCtx(), "2026-09", db());
    expect(data.events).toEqual({
      ok: false,
      message: expect.stringContaining("not connected yet"),
    });
    expect(data.chores.ok).toBe(true);
    expect(data.notes.ok).toBe(true);
  });

  it("turns a read that throws into that part's failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = await import("@/lib/actions/registry");
    const real = registry.runAction;
    const spy = vi
      .spyOn(registry, "runAction")
      .mockImplementation(((name: string, input: unknown, ctx: never) =>
        name === "list_notes"
          ? Promise.reject(new Error("boom"))
          : real(name, input, ctx)) as never);
    const data = await loadDashboard(kioskCtx(), "2026-09", db());
    expect(spy).toHaveBeenCalled();
    expect(data.notes).toEqual({
      ok: false,
      message: "This could not be loaded just now. It will try again.",
    });
    expect(data.chores.ok).toBe(true);
    expect(data.events.ok).toBe(true);
    expect(errors).toHaveBeenCalledWith(
      "[kiosk] a dashboard read failed",
      expect.any(Error),
    );
  });
});
