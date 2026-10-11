// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { useTestDb } from "@baumy/db/test-harness";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { members } from "@baumy/db/schema";
import { eq } from "drizzle-orm";
import { MEMBER_COLORS } from "@baumy/types";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { runAction } from "@/lib/actions/registry";
import {
  setBrainClientForTests,
  unconfiguredBrain,
} from "@/lib/integrations/brain";
import {
  clearMemoryShopping,
  memoryAdd,
  memoryBrain,
} from "@/lib/integrations/brain-memory";
import {
  setCalendarClientForTests,
  unconfiguredCalendar,
} from "@/lib/integrations/calendar";
import type {
  CalendarClient,
  TimeRange,
} from "@/lib/integrations/google-calendar";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { loadDashboard, shoppingCount } from "./dashboard-load";

// The kitchen dashboard's reads through the real runAction on PGlite
// (issue #65), as the paired device before anyone taps in: the whole month
// grid's events, the notes and the members' characters, and one failing
// read (the calendar down, or throwing) leaves the others alone; and the
// Shopping icon's count (issue #193).

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const readMembers = () => listActiveMembers(db(), HOUSEHOLD_ID);
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
            forMember: null,
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
            forMember: null,
          },
        ],
      };
    },
  } satisfies CalendarClient);
});

afterEach(() => {
  setCalendarClientForTests(null);
  setBrainClientForTests(null);
  clearMemoryShopping();
  vi.restoreAllMocks();
});

describe("loadDashboard", () => {
  it("reads the month's events, the notes and the members, and no chores", async () => {
    await runAction(
      "create_note",
      { title: "Pasta", bodyMd: "Who ate it?" },
      ctxFor(sessionActor(ryan)),
    );
    const data = await loadDashboard(kioskCtx(), "2026-10", readMembers);
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
    // The star only opens the Bounties tab (issue #193): no chores read.
    expect(data).not.toHaveProperty("chores");
    expect(data.notes).toMatchObject({
      ok: true,
      // Ryan wrote it, so has read it; he is everyone here.
      data: {
        notes: [{ title: "Pasta", authorId: ryan, seenBy: [ryan] }],
        unseenByAnyoneCount: 0,
      },
    });
    expect(data.members).toEqual([
      { id: ryan, displayName: "Ryan", color: "#336699", sprites: null },
    ]);
  });

  it("gives each active member their own colour, in join order", async () => {
    const jo = await seedMember(db(), {
      displayName: "Jo",
      color: MEMBER_COLORS[5],
    });
    await seedMember(db(), { displayName: "Gone", deactivatedAt: FIXED_NOW });
    await t
      .db()
      .update(members)
      .set({ color: MEMBER_COLORS[1] })
      .where(eq(members.id, ryan));
    const data = await loadDashboard(kioskCtx(), "2026-09", readMembers);
    expect(data.members.map((m) => [m.id, m.color])).toEqual([
      [ryan, MEMBER_COLORS[1]],
      [jo, MEMBER_COLORS[5]],
    ]);
  });

  it("says the calendar is not connected, and reads everything else", async () => {
    setCalendarClientForTests(unconfiguredCalendar);
    const data = await loadDashboard(kioskCtx(), "2026-09", readMembers);
    expect(data.events).toEqual({
      ok: false,
      message: expect.stringContaining("not connected yet"),
    });
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
    const data = await loadDashboard(kioskCtx(), "2026-09", readMembers);
    expect(spy).toHaveBeenCalled();
    expect(data.notes).toEqual({
      ok: false,
      message: "This could not be loaded just now. It will try again.",
    });
    expect(data.events.ok).toBe(true);
    expect(errors).toHaveBeenCalledWith(
      "[kiosk] a dashboard read failed",
      expect.any(Error),
    );
  });
});

describe("shoppingCount", () => {
  it("counts the open items on brain's list", async () => {
    setBrainClientForTests(memoryBrain());
    expect(await shoppingCount(kioskCtx())).toBe(0);
    memoryAdd(["milk", "eggs", "bread"]);
    expect(await shoppingCount(kioskCtx())).toBe(3);
  });

  it("is null, never an error, when brain is not set up", async () => {
    setBrainClientForTests(unconfiguredBrain);
    expect(await shoppingCount(kioskCtx())).toBeNull();
  });

  it("is null when the read throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    setBrainClientForTests({
      ...memoryBrain(),
      listShopping: () => Promise.reject(new Error("boom")),
    });
    expect(await shoppingCount(kioskCtx())).toBeNull();
    // runAction logged it and answered INTERNAL; nothing reached the page.
    expect(errors).toHaveBeenCalled();
  });
});
