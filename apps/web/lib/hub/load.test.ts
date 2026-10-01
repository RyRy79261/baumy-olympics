// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { useTestDb } from "@baumy/db/test-harness";
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
import type { CalendarClient } from "@/lib/integrations/google-calendar";
import {
  setBrainClientForTests,
  unconfiguredBrain,
} from "@/lib/integrations/brain";
import {
  clearMemoryShopping,
  memoryAdd,
  memoryBrain,
} from "@/lib/integrations/brain-memory";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { NEW_BOUNTY_MS } from "@/lib/chores/urgency";
import { HUB_NOTES, loadHub } from "./load";

// The hub's reads through the real runAction on PGlite (issue #20): each
// widget gets its data, its empty state or its own failure, and one failing
// read (the calendar down, or throwing) leaves the others alone.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const HOUR = 3_600_000;
const iso = (h: number) =>
  new Date(FIXED_NOW.getTime() + h * HOUR).toISOString();

function calendarWith(list: CalendarClient["list"]): CalendarClient {
  return { ...unconfiguredCalendar, list };
}

let ryan: string;

/**
 * Trash, added long ago and last done by Ryan 5 days ago: a day past its
 * 4-day rhythm, so urgent. A chore never done is not (SPEC §12 decision 22).
 */
async function seedOverdueTrash() {
  const { choreId } = await seedChore(db(), {
    ...SEED_CHORES.trash,
    createdAt: new Date(FIXED_NOW.getTime() - NEW_BOUNTY_MS - 6 * 24 * HOUR),
  });
  const fiveDaysAgo = new Date(FIXED_NOW.getTime() - 5 * 24 * HOUR);
  const logged = await runAction(
    "log_completion",
    { choreId, occurredAt: fiveDaysAgo.toISOString() },
    ctxFor(sessionActor(ryan), { now: fiveDaysAgo }),
  );
  expect(logged.ok).toBe(true);
}

beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), { displayName: "Ryan" });
  setCalendarClientForTests(
    calendarWith(async () => ({
      ok: true,
      data: [
        {
          id: "dinner",
          title: "Dinner",
          description: null,
          location: null,
          allDay: false,
          start: iso(7),
          end: iso(8),
          private: false,
          member: null,
        },
      ],
    })),
  );
});

afterEach(() => {
  setCalendarClientForTests(null);
  setBrainClientForTests(null);
  clearMemoryShopping();
  vi.restoreAllMocks();
});

describe("loadHub", () => {
  it("fills every widget from its action", async () => {
    // Trash was added long ago and last done 5 days ago, a day past its
    // 4-day rhythm: urgent. Dishes was added an hour ago and never done:
    // new, not urgent (SPEC §12 decision 22).
    await seedOverdueTrash();
    await seedChore(db(), {
      ...SEED_CHORES.dishes,
      createdAt: new Date(FIXED_NOW.getTime() - HOUR),
    });
    const pinned = await runAction(
      "create_note",
      { title: "Wifi", bodyMd: "guest", pinned: true },
      ctxFor(sessionActor(ryan)),
    );
    await runAction(
      "create_note",
      { title: "Loose" },
      ctxFor(sessionActor(ryan)),
    );
    const hub = await loadHub(ctxFor(sessionActor(ryan)));
    expect(hub.now).toBe(FIXED_NOW.toISOString());
    expect(hub.events).toEqual({
      status: "ready",
      data: [
        {
          id: "dinner",
          title: "Dinner",
          time: "19:00–20:00",
          location: null,
          addedBy: null,
        },
      ],
    });
    expect(hub.chores).toMatchObject({
      status: "ready",
      data: [
        {
          name: SEED_CHORES.trash.name,
          when: "Due since Sat 26 Sep, 12:00",
          overdue: true,
          isNew: false,
        },
      ],
    });
    expect(hub.standings).toEqual({
      status: "ready",
      data: [
        {
          memberId: ryan,
          displayName: "Ryan",
          rank: 1,
          points: SEED_CHORES.trash.basePoints,
          gap: "Leader",
        },
      ],
    });
    expect(hub.pot).toEqual({ ok: true, total: "€0.00" });
    expect(hub.notes).toMatchObject({
      status: "ready",
      data: [{ id: pinned.ok && pinned.data.note.id, title: "Wifi" }],
    });
    // Only Trash is urgent (Dishes was never done); only Dishes is new; both
    // notes are from today.
    expect(hub.counts).toEqual({ urgent: 1, new: 1, messages: 2 });
  });

  it("counts nothing for a tile whose read failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = await import("@/lib/actions/registry");
    const real = registry.runAction;
    vi.spyOn(registry, "runAction").mockImplementation(((
      name: string,
      input: unknown,
      ctx: never,
    ) =>
      name === "list_chores" || name === "list_notes"
        ? Promise.reject(new Error("boom"))
        : real(name, input, ctx)) as never);
    const hub = await loadHub(ctxFor(sessionActor(ryan)));
    expect(hub.counts).toEqual({ urgent: null, new: null, messages: null });
    expect(hub.standings.status).toBe("ready");
  });

  it("shows brain's shopping list, empty or not", async () => {
    setBrainClientForTests(memoryBrain());
    expect((await loadHub(ctxFor(sessionActor(ryan)))).shopping).toEqual({
      status: "ready",
      data: [],
    });
    memoryAdd(["milk", "eggs"]);
    const hub = await loadHub(ctxFor(kioskActor(), { source: "kiosk" }));
    expect(
      hub.shopping.status === "ready" && hub.shopping.data.map((i) => i.item),
    ).toEqual(["milk", "eggs"]);
  });

  it("says the shopping list is unavailable when brain is down, and shows everything else", async () => {
    await seedOverdueTrash();
    setBrainClientForTests({
      ...unconfiguredBrain,
      listShopping: async () => ({ ok: false, reason: "unavailable" }),
    });
    const hub = await loadHub(ctxFor(kioskActor(), { source: "kiosk" }));
    expect(hub.shopping).toEqual({
      status: "unavailable",
      message: expect.stringContaining("The shopping list is unavailable"),
    });
    expect(hub.events.status).toBe("ready");
    expect(hub.chores.status).toBe("ready");
    expect(hub.standings.status).toBe("ready");
    expect(hub.pot.ok).toBe(true);
    // Not set up at all: it says so instead.
    setBrainClientForTests(null);
    expect((await loadHub(ctxFor(sessionActor(ryan)))).shopping).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("not connected yet"),
    });
  });

  it("gives each widget its own empty sentence", async () => {
    setCalendarClientForTests(
      calendarWith(async () => ({ ok: true, data: [] })),
    );
    const hub = await loadHub(ctxFor(sessionActor(ryan)));
    expect(hub.events).toEqual({
      status: "empty",
      message: "Nothing else on the calendar today.",
    });
    expect(hub.chores).toEqual({
      status: "empty",
      message: "Nothing is due. Nice.",
    });
    expect(hub.notes).toEqual({
      status: "empty",
      message: "Nothing is pinned. Pin a note on the Board.",
    });
  });

  it("says the calendar is not connected, and shows everything else", async () => {
    await seedOverdueTrash();
    setCalendarClientForTests(unconfiguredCalendar);
    const hub = await loadHub(ctxFor(sessionActor(ryan)));
    expect(hub.events).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("not connected yet"),
    });
    expect(hub.chores.status).toBe("ready");
    expect(hub.standings.status).toBe("ready");
    expect(hub.pot.ok).toBe(true);
  });

  it("survives a calendar that times out or throws", async () => {
    setCalendarClientForTests(
      calendarWith(async () => ({ ok: false, reason: "unavailable" })),
    );
    expect((await loadHub(ctxFor(sessionActor(ryan)))).events).toMatchObject({
      status: "unavailable",
      message: "Google Calendar did not answer. Try again in a minute.",
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    setCalendarClientForTests(
      calendarWith(async () => {
        throw new Error("socket hang up");
      }),
    );
    const hub = await loadHub(ctxFor(sessionActor(ryan)));
    expect(hub.events.status).toBe("unavailable");
    expect(hub.standings.status).toBe("ready");
    expect(hub.notes.status).toBe("empty");
    // runAction logged it and answered INTERNAL; nothing reached the page.
    expect(errors).toHaveBeenCalled();
  });

  it("turns a read that throws into that widget's failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = await import("@/lib/actions/registry");
    const real = registry.runAction;
    const spy = vi
      .spyOn(registry, "runAction")
      .mockImplementation(((name: string, input: unknown, ctx: never) =>
        name === "get_pot"
          ? Promise.reject(new Error("boom"))
          : real(name, input, ctx)) as never);
    const hub = await loadHub(ctxFor(sessionActor(ryan)));
    expect(spy).toHaveBeenCalled();
    expect(hub.pot).toEqual({
      ok: false,
      message: "This could not be loaded just now. It will try again.",
    });
    expect(hub.standings.status).toBe("ready");
    expect(errors).toHaveBeenCalledWith(
      "[hub] a widget's read failed",
      expect.any(Error),
    );
  });

  it("reads for the kitchen screen before anyone taps in", async () => {
    for (let i = 0; i < HUB_NOTES + 1; i++) {
      await runAction(
        "create_note",
        { title: `Pinned ${i}`, pinned: true },
        ctxFor(sessionActor(ryan)),
      );
    }
    const hub = await loadHub(ctxFor(kioskActor(), { source: "kiosk" }));
    expect(hub.notes.status === "ready" && hub.notes.data).toHaveLength(
      HUB_NOTES,
    );
    expect(hub.standings.status).toBe("ready");
    expect(hub.pot.ok).toBe(true);
  });
});
