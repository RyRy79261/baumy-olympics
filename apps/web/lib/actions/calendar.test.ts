// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable, Tx } from "@baumy/db";
import { actionRequests, auditEvents } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  accountActor,
  allowAll,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import {
  setCalendarClientForTests,
  unconfiguredCalendar,
} from "@/lib/integrations/calendar";
import {
  clearMemoryCalendar,
  memoryCalendar,
  seedMemoryEvent,
} from "@/lib/integrations/calendar-memory";
import type { CalendarClient } from "@/lib/integrations/google-calendar";
import { calendarFailure, eventIdFor, specOf } from "./calendar";
import type { RequestCtx } from "./define";
import { REGISTRY } from "./registry";
import { createRunner, defaultDeps, type RunnerDeps } from "./run";

// The calendar actions through the real runner on PGlite (issue #19):
// success, each error code, the surfaces and the permissions, the DST
// acceptance test, and that no database transaction is open while Google is
// called (the depth each calendar call sees must be 0). The writes are
// `member` (owner ruling 2026-10-02, issue #145): the kiosk's acting member
// changes the calendar with no PIN, even one who never set a PIN.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

let txDepth = 0;
/** The open-transaction depth at each calendar call, by method. */
let seen: [string, number][] = [];
let txCalls = 0;
let failTxAt: number | null = null;

/** The next detached write's audit transaction (its second) throws. */
function failNextAudit() {
  failTxAt = txCalls + 2;
}

/** The fake calendar, noting how many transactions are open at each call. */
function watching(inner: CalendarClient): CalendarClient {
  const out = {} as CalendarClient;
  for (const key of Object.keys(inner) as (keyof CalendarClient)[]) {
    out[key] = (async (...args: unknown[]) => {
      seen.push([key, txDepth]);
      return (inner[key] as (...a: unknown[]) => unknown)(...args);
    }) as never;
  }
  return out;
}

let run: ReturnType<typeof createRunner>;

const PIN = "2580";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

/** A member with a kiosk PIN. */
const seedPinned = () => seedMember(db(), { kioskPinHash: pinHash });

/** The kiosk acting as `memberId`, with the PIN when given. */
const atKiosk = (memberId: string, pin?: string) =>
  ctxFor(kiosk(memberId), { source: "kiosk", ...(pin ? { pin } : {}) });

beforeEach(() => {
  txDepth = 0;
  seen = [];
  txCalls = 0;
  failTxAt = null;
  clearMemoryCalendar();
  setCalendarClientForTests(watching(memoryCalendar()));
  const deps: RunnerDeps = {
    ...defaultDeps,
    rateLimiter: allowAll,
    logError: () => {},
    withTransaction: async <T>(fn: (tx: Tx) => Promise<T>) => {
      txCalls += 1;
      // A detached write opens two: the claim, then the audit.
      if (txCalls === failTxAt) throw new Error("connection reset");
      txDepth += 1;
      try {
        return await defaultDeps.withTransaction(fn);
      } finally {
        txDepth -= 1;
      }
    },
  };
  run = createRunner(REGISTRY, deps);
});

afterEach(() => setCalendarClientForTests(null));

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data as T;
}

const kiosk = (memberId?: string): Actor => ({
  kind: "kiosk",
  deviceId: "dev-1",
  ...(memberId ? { memberId, displayName: "K" } : {}),
});
const mcp = (memberId: string, scopes = ["baumy:read", "baumy:write"]) =>
  ({ kind: "mcp", memberId, scopes }) as Actor;
const brain = (memberId: string): Actor => ({
  kind: "service",
  tokenName: "baumy-brain",
  memberId,
});

const dinner = (date: string) => ({
  title: "Dinner",
  kind: "timed",
  date,
  startTime: "19:00",
  endTime: "20:30",
});

async function audits() {
  return t.db().select().from(auditEvents);
}

async function requests() {
  return t.db().select().from(actionRequests);
}

describe("create_event", () => {
  it("puts 19:00 Berlin in January and in July at 19:00 (the DST test, from the kiosk)", async () => {
    const me = await seedPinned();
    for (const [date, utc] of [
      ["2027-01-15", "2027-01-15T18:00:00.000Z"],
      ["2027-07-15", "2027-07-15T17:00:00.000Z"],
    ]) {
      const ctx = atKiosk(me, PIN);
      const data = ok(await run("create_event", dinner(date!), ctx)) as {
        event: {
          id: string;
          start: string;
          startTime: string;
          addedBy: string;
        };
      };
      expect(data.event).toMatchObject({
        start: utc,
        startTime: "19:00",
        addedBy: me,
      });
      expect(data.event.id).toBe(eventIdFor(ctx));
      // And Google, read back, has it at that instant.
      const listed = ok(
        await run("list_events", { from: date, to: date }, ctx),
      ) as { events: { start: string; when: string }[] };
      expect(listed.events.map((e) => e.start)).toEqual([utc]);
      expect(listed.events[0]!.when).toContain("19:00–20:30");
    }
  });

  it("calls Google with no transaction open, then audits the event", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const data = ok(await run("create_event", dinner("2027-01-15"), ctx)) as {
      event: { id: string };
    };
    expect(seen).toEqual([["create", 0]]);
    const [row] = await audits();
    expect(row).toMatchObject({
      action: "create_event",
      entity: "calendar_event",
      entityId: data.event.id,
      actorMemberId: me,
      source: "ui",
    });
    expect((await requests())[0]).toMatchObject({ status: "done" });
  });

  it("replays the same request without a second event, and a retry names the same event", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const first = await run("create_event", dinner("2027-01-15"), ctx);
    expect(await run("create_event", dinner("2027-01-15"), ctx)).toEqual(first);
    expect(seen.map(([m]) => m)).toEqual(["create"]);
    expect(eventIdFor(ctx)).toBe(eventIdFor({ ...ctx }));
    expect(eventIdFor(ctx)).not.toBe(
      eventIdFor({ ...ctx, requestId: "another-request" }),
    );
    expect(eventIdFor(ctx)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("deletes the event again when the audit cannot be written", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    failNextAudit();
    const res = await run("create_event", dinner("2027-01-15"), ctx);
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(seen.map(([m, depth]) => [m, depth])).toEqual([
      ["create", 0],
      ["delete", 0],
    ]);
    expect(await memoryCalendar().get(eventIdFor(ctx))).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await audits()).toHaveLength(0);

    // The form retries with the same request id: the undone event comes back.
    const retry = ok(await run("create_event", dinner("2027-01-15"), ctx)) as {
      event: { id: string; start: string };
    };
    expect(retry.event).toMatchObject({
      id: eventIdFor(ctx),
      start: "2027-01-15T18:00:00.000Z",
    });
    expect(await memoryCalendar().get(eventIdFor(ctx))).toMatchObject({
      ok: true,
    });
    expect(await audits()).toHaveLength(1);
  });

  it("says the calendar is not connected, and stores nothing", async () => {
    const me = await seedMember(db());
    setCalendarClientForTests(unconfiguredCalendar);
    const res = await run(
      "create_event",
      dinner("2027-01-15"),
      ctxFor(sessionActor(me)),
    );
    expect(res).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(await audits()).toHaveLength(0);
    expect((await requests())[0]).toMatchObject({ status: "failed" });
  });

  it("calls a refused create unavailable, even a 404", async () => {
    const me = await seedMember(db());
    for (const reason of ["unavailable", "not_found"] as const) {
      setCalendarClientForTests({
        ...unconfiguredCalendar,
        create: async () => ({ ok: false, reason }),
      });
      expect(
        await run(
          "create_event",
          dinner("2027-01-15"),
          ctxFor(sessionActor(me)),
        ),
      ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    }
  });

  it("checks the fields before calling Google", async () => {
    const me = await seedMember(db());
    const res = await run(
      "create_event",
      { ...dinner("2027-01-15"), endTime: "18:00" },
      ctxFor(sessionActor(me)),
    );
    expect(res).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["endTime"] }],
    });
    expect(seen).toEqual([]);
  });

  it("needs a member, and on the kiosk no PIN", async () => {
    const me = await seedPinned();
    expect(
      await run(
        "create_event",
        dinner("2027-01-15"),
        ctxFor(accountActor("nobody")),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await run(
        "create_event",
        dinner("2027-01-15"),
        ctxFor(kiosk(), { source: "kiosk" }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(seen).toEqual([]);
    // MCP needs the write scope.
    expect(
      await run(
        "create_event",
        dinner("2027-01-15"),
        ctxFor(mcp(me, ["baumy:read"]), { source: "mcp" }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    // A session, MCP and brain are their own member, and the kiosk's acting
    // member needs no PIN either (issue #145).
    for (const [actor, source] of [
      [mcp(me), "mcp"],
      [brain(me), "brain"],
      [sessionActor(me), "ai"],
      [kiosk(me), "kiosk"],
    ] as const) {
      expect(
        await run(
          "create_event",
          dinner("2027-01-15"),
          ctxFor(actor, { source } as Partial<RequestCtx>),
        ),
        source,
      ).toMatchObject({ ok: true });
    }
    expect(seen).toHaveLength(4);
  });

  it("is for one member of the house, or for the house (issue #134)", async () => {
    const me = await seedMember(db());
    const anna = await seedMember(db(), { displayName: "Anna" });
    const forAnna = ok(
      await run(
        "create_event",
        { ...dinner("2027-01-15"), forMemberId: anna },
        ctxFor(sessionActor(me)),
      ),
    ) as { event: { id: string; forMember: string | null; addedBy: string } };
    expect(forAnna.event).toMatchObject({ forMember: anna, addedBy: me });
    const listed = ok(
      await run(
        "list_events",
        { from: "2027-01-15" },
        ctxFor(sessionActor(me)),
      ),
    ) as { events: { id: string; forMember: string | null }[] };
    expect(listed.events).toEqual([
      expect.objectContaining({ id: forAnna.event.id, forMember: anna }),
    ]);
    const house = ok(
      await run(
        "create_event",
        dinner("2027-01-16"),
        ctxFor(sessionActor(me), { requestId: "house-dinner-1" }),
      ),
    ) as { event: { forMember: string | null } };
    expect(house.event.forMember).toBeNull();
  });

  it("refuses an event for someone who is not in the house, before Google", async () => {
    const me = await seedMember(db());
    const gone = await seedMember(db(), { deactivatedAt: FIXED_NOW });
    for (const forMemberId of [gone, "6f1c2b9e-3a4d-4e5f-8a9b-0c1d2e3f4a5b"]) {
      expect(
        await run(
          "create_event",
          { ...dinner("2027-01-15"), forMemberId },
          ctxFor(sessionActor(me), { requestId: `for-${forMemberId}` }),
        ),
      ).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        issues: [
          { path: ["forMemberId"], message: "Pick someone in the house." },
        ],
      });
    }
    expect(seen).toEqual([]);
  });

  it("previews what it will add", async () => {
    expect(
      await REGISTRY.create_event.preview!(
        { ...ctxFor(sessionActor("m")), db: db() },
        {
          title: "Dinner",
          kind: "timed",
          date: "2027-07-15",
          startTime: "19:00",
          endTime: "20:30",
        },
      ),
    ).toBe('Add "Dinner" on Thu 15 Jul, 19:00–20:30');
    expect(
      await REGISTRY.create_event.preview!(
        { ...ctxFor(sessionActor("m")), db: db() },
        {
          title: "Trip",
          kind: "all_day",
          date: "2027-07-01",
          endDate: "2027-07-03",
        },
      ),
    ).toBe('Add "Trip" on Thu 1 Jul – Sat 3 Jul, all day');
  });
});

describe("list_events", () => {
  it("lists today by default, and leaves private events out", async () => {
    const me = await seedMember(db());
    const today = "2026-09-27";
    await run("create_event", dinner(today), ctxFor(sessionActor(me)));
    seedMemoryEvent({
      id: "private01",
      summary: "Doctor",
      visibility: "private",
      start: { dateTime: "2026-09-27T08:00:00Z" },
      end: { dateTime: "2026-09-27T09:00:00Z" },
    });
    expect(
      (await memoryCalendar().get("private01")).ok,
      "the private event is there",
    ).toBe(true);
    const data = ok(await run("list_events", {}, ctxFor(sessionActor(me)))) as {
      from: string;
      to: string;
      events: { title: string }[];
    };
    expect(FIXED_NOW.toISOString().slice(0, 10)).toBe(today);
    expect(data).toMatchObject({ from: today, to: today });
    expect(data.events.map((e) => e.title)).toEqual(["Dinner"]);
  });

  it("works on every surface and writes nothing", async () => {
    const me = await seedMember(db());
    for (const [actor, source] of [
      [sessionActor(me), "ui"],
      [kiosk(me), "kiosk"],
      [sessionActor(me), "ai"],
      [mcp(me, ["baumy:read"]), "mcp"],
      [brain(me), "brain"],
    ] as const) {
      expect(
        await run(
          "list_events",
          {},
          ctxFor(actor, { source } as Partial<RequestCtx>),
        ),
        source,
      ).toMatchObject({ ok: true });
    }
    expect(await audits()).toHaveLength(0);
    expect(await requests()).toHaveLength(0);
  });

  it("refuses a range that is backwards from today, or too wide", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    expect(await run("list_events", { to: "2026-09-01" }, ctx)).toMatchObject({
      code: "INVALID_INPUT",
      issues: [{ path: ["to"] }],
    });
    expect(
      await run("list_events", { from: "2026-01-01", to: "2026-12-31" }, ctx),
    ).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("says not connected or unavailable rather than failing", async () => {
    const me = await seedMember(db());
    setCalendarClientForTests(unconfiguredCalendar);
    expect(
      await run("list_events", {}, ctxFor(sessionActor(me))),
    ).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    setCalendarClientForTests({
      ...unconfiguredCalendar,
      list: async () => ({ ok: false, reason: "unavailable" }),
    });
    expect(
      await run("list_events", {}, ctxFor(sessionActor(me))),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("update_event", () => {
  async function created(me: string) {
    const data = ok(
      await run("create_event", dinner("2027-01-15"), ctxFor(sessionActor(me))),
    ) as { event: { id: string } };
    seen = [];
    return data.event.id;
  }

  it("changes every field, with no transaction open, and audits it", async () => {
    const me = await seedMember(db());
    const other = await seedMember(db());
    const id = await created(me);
    const data = ok(
      await run(
        "update_event",
        {
          eventId: id,
          title: "Trip",
          kind: "all_day",
          date: "2027-01-16",
          endDate: "2027-01-17",
          location: "Lake",
        },
        ctxFor(sessionActor(other)),
      ),
    ) as { event: Record<string, unknown> };
    expect(data.event).toMatchObject({
      title: "Trip",
      allDay: true,
      startDate: "2027-01-16",
      endDate: "2027-01-17",
      location: "Lake",
      // Still the member who added it.
      addedBy: me,
    });
    expect(seen).toEqual([
      ["get", 0],
      ["update", 0],
    ]);
    const rows = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "update_event"));
    expect(rows).toMatchObject([
      { entity: "calendar_event", entityId: id, actorMemberId: other },
    ]);
  });

  it("puts the old fields back when the audit cannot be written", async () => {
    const me = await seedMember(db());
    const id = await created(me);
    failNextAudit();
    expect(
      await run(
        "update_event",
        { ...dinner("2027-01-20"), eventId: id, title: "Moved" },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "INTERNAL" });
    expect(await memoryCalendar().get(id)).toMatchObject({
      ok: true,
      data: { title: "Dinner", start: "2027-01-15T18:00:00.000Z" },
    });
  });

  it("does not find a missing or private event, and does not touch it", async () => {
    const me = await seedMember(db());
    seedMemoryEvent({
      id: "private01",
      summary: "Doctor",
      visibility: "private",
      start: { dateTime: "2027-01-15T08:00:00Z" },
      end: { dateTime: "2027-01-15T09:00:00Z" },
    });
    for (const eventId of ["private01", "missing01"]) {
      expect(
        await run(
          "update_event",
          { ...dinner("2027-01-15"), eventId },
          ctxFor(sessionActor(me)),
        ),
        eventId,
      ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
    expect(seen.map(([m]) => m)).toEqual(["get", "get"]);
    expect(await memoryCalendar().get("private01")).toMatchObject({
      data: { title: "Doctor" },
    });
  });

  it("reports a failed update", async () => {
    const me = await seedMember(db());
    const id = await created(me);
    const fake = memoryCalendar();
    setCalendarClientForTests({
      ...fake,
      update: async () => ({ ok: false, reason: "unavailable" }),
    });
    expect(
      await run(
        "update_event",
        { ...dinner("2027-01-15"), eventId: id },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("previews the change", async () => {
    expect(
      await REGISTRY.update_event.preview!(
        { ...ctxFor(sessionActor("m")), db: db() },
        { ...dinner("2027-01-15"), eventId: "abcde123", kind: "timed" },
      ),
    ).toBe('Change "Dinner" to Fri 15 Jan, 19:00–20:30');
  });

  it("previews who it is for when that is said, and refuses a stranger before the card (issue #134)", async () => {
    const anna = await seedMember(db(), { displayName: "Anna" });
    const gone = await seedMember(db(), { deactivatedAt: FIXED_NOW });
    const ctx = { ...ctxFor(sessionActor("m")), db: db() };
    const change = { ...dinner("2027-01-15"), eventId: "abcde123" } as const;
    const updatePreview = (forMemberId: string | null) =>
      REGISTRY.update_event.preview!(ctx, {
        ...change,
        kind: "timed",
        forMemberId,
      });
    expect(await updatePreview(anna)).toBe(
      'Change "Dinner" to Fri 15 Jan, 19:00–20:30 and make it for Anna',
    );
    expect(await updatePreview(null)).toBe(
      'Change "Dinner" to Fri 15 Jan, 19:00–20:30 and make it for everyone',
    );
    expect(await updatePreview(gone)).toEqual({
      invalid: "Pick someone in the house.",
    });
    const addPreview = (forMemberId: string | null) =>
      REGISTRY.create_event.preview!(ctx, {
        ...dinner("2027-01-15"),
        kind: "timed",
        forMemberId,
      });
    expect(await addPreview(anna)).toBe(
      'Add "Dinner" on Fri 15 Jan, 19:00–20:30 for Anna',
    );
    expect(await addPreview(null)).toBe(
      'Add "Dinner" on Fri 15 Jan, 19:00–20:30',
    );
    expect(await addPreview("6f1c2b9e-3a4d-4e5f-8a9b-0c1d2e3f4a5b")).toEqual({
      invalid: "Pick someone in the house.",
    });
  });
});

describe("delete_event", () => {
  it("deletes with no transaction open and audits the title", async () => {
    const me = await seedPinned();
    const ctx = atKiosk(me, PIN);
    const { event } = ok(
      await run("create_event", dinner("2027-01-15"), ctx),
    ) as { event: { id: string } };
    seen = [];
    const data = ok(
      await run("delete_event", { eventId: event.id }, atKiosk(me, PIN)),
    );
    expect(data).toEqual({ eventId: event.id, title: "Dinner" });
    expect(seen).toEqual([
      ["get", 0],
      ["delete", 0],
    ]);
    expect(await memoryCalendar().get(event.id)).toMatchObject({
      reason: "not_found",
    });
    const [row] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delete_event"));
    expect(row).toMatchObject({
      entityId: event.id,
      payload: { eventId: event.id, title: "Dinner" },
    });
  });

  it("brings the event back when the audit cannot be written", async () => {
    const me = await seedMember(db());
    const { event } = ok(
      await run("create_event", dinner("2027-01-15"), ctxFor(sessionActor(me))),
    ) as { event: { id: string } };
    failNextAudit();
    expect(
      await run(
        "delete_event",
        { eventId: event.id },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "INTERNAL" });
    expect(await memoryCalendar().get(event.id)).toMatchObject({ ok: true });
  });

  it("is never offered over MCP; brain may delete (issue #70)", async () => {
    const me = await seedMember(db());
    expect(REGISTRY.delete_event.risk).toBe("destructive");
    const { event } = ok(
      await run("create_event", dinner("2027-01-15"), ctxFor(sessionActor(me))),
    ) as { event: { id: string } };
    seen = [];
    expect(
      await run(
        "delete_event",
        { eventId: event.id },
        ctxFor(mcp(me), { source: "mcp" }),
      ),
    ).toMatchObject({ code: "SURFACE_FORBIDDEN" });
    expect(seen).toEqual([]);
    const data = ok(
      await run(
        "delete_event",
        { eventId: event.id },
        ctxFor(brain(me), { source: "brain" }),
      ),
    );
    expect(data).toEqual({ eventId: event.id, title: "Dinner" });
    expect(await memoryCalendar().get(event.id)).toMatchObject({
      reason: "not_found",
    });
  });

  it("does not find a private or missing event, and reports a failed delete", async () => {
    const me = await seedMember(db());
    seedMemoryEvent({
      id: "private01",
      visibility: "confidential",
      start: { date: "2027-01-15" },
    });
    expect(
      await run(
        "delete_event",
        { eventId: "private01" },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(await memoryCalendar().get("private01")).toMatchObject({ ok: true });
    setCalendarClientForTests({
      ...memoryCalendar(),
      delete: async () => ({ ok: false, reason: "unavailable" }),
    });
    const { event } = ok(
      await run("create_event", dinner("2027-01-15"), ctxFor(sessionActor(me))),
    ) as { event: { id: string } };
    expect(
      await run(
        "delete_event",
        { eventId: event.id },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("previews with the event's title when it can see it", async () => {
    const me = await seedMember(db());
    const { event } = ok(
      await run("create_event", dinner("2027-01-15"), ctxFor(sessionActor(me))),
    ) as { event: { id: string } };
    const c = { ...ctxFor(sessionActor(me)), db: db() };
    expect(await REGISTRY.delete_event.preview!(c, { eventId: event.id })).toBe(
      'Delete "Dinner" (Fri 15 Jan, 19:00–20:30)',
    );
    expect(
      await REGISTRY.delete_event.preview!(c, { eventId: "missing01" }),
    ).toBe("Delete this event");
  });
});

describe("changing and deleting on the kiosk, and who it is for (issue #134)", () => {
  it("adds, changes and deletes on the kiosk with no PIN, for a member who never set one (issue #145)", async () => {
    const me = await seedMember(db(), { displayName: "Charl" });
    const { event } = ok(
      await run("create_event", dinner("2027-01-15"), atKiosk(me)),
    ) as { event: { id: string; addedBy: string } };
    expect(event.addedBy).toBe(me);
    expect(
      ok(
        await run(
          "update_event",
          { ...dinner("2027-01-15"), eventId: event.id, title: "Moved" },
          atKiosk(me),
        ),
      ),
    ).toMatchObject({ event: { title: "Moved" } });
    // A PIN sent along anyway is not checked: even a wrong one is fine.
    expect(
      ok(await run("delete_event", { eventId: event.id }, atKiosk(me, "1111"))),
    ).toEqual({ eventId: event.id, title: "Moved" });
    const kioskAudits = (await audits()).filter((a) => a.source === "kiosk");
    expect(kioskAudits.map((a) => a.action)).toEqual([
      "create_event",
      "update_event",
      "delete_event",
    ]);
    expect(kioskAudits.every((a) => a.actorMemberId === me)).toBe(true);
  });

  it("keeps who it is for when left out, makes it the house's with null, and an undo puts it back", async () => {
    const me = await seedMember(db());
    const anna = await seedMember(db(), { displayName: "Anna" });
    const bo = await seedMember(db(), { displayName: "Bo" });
    const { event } = ok(
      await run(
        "create_event",
        { ...dinner("2027-01-15"), forMemberId: anna },
        ctxFor(sessionActor(me)),
      ),
    ) as { event: { id: string } };
    const update = (
      forMemberId: string | null | undefined,
      requestId: string,
    ) =>
      run(
        "update_event",
        {
          ...dinner("2027-01-15"),
          eventId: event.id,
          ...(forMemberId === undefined ? {} : { forMemberId }),
        },
        ctxFor(sessionActor(me), { requestId }),
      );
    expect(ok(await update(bo, "to-bo-0001"))).toMatchObject({
      event: { forMember: bo, addedBy: me },
    });
    // Left out (an AI, MCP or brain change of the time only): still Bo's.
    expect(ok(await update(undefined, "keep-bo-001"))).toMatchObject({
      event: { forMember: bo, addedBy: me },
    });
    expect(ok(await update(null, "to-house-01"))).toMatchObject({
      event: { forMember: null, addedBy: me },
    });
    // For Anna, then Bo, but that audit fails: the undo puts Anna back.
    await update(anna, "to-anna-001");
    failNextAudit();
    expect(await update(bo, "to-bo-0002")).toMatchObject({ code: "INTERNAL" });
    expect(await memoryCalendar().get(event.id)).toMatchObject({
      ok: true,
      data: { forMember: anna, member: me },
    });
    // Someone who left the house is refused on a change too.
    const gone = await seedMember(db(), { deactivatedAt: FIXED_NOW });
    expect(await update(gone, "to-gone-001")).toMatchObject({
      code: "INVALID_INPUT",
      issues: [{ path: ["forMemberId"] }],
    });
  });
});

describe("helpers", () => {
  it("turns each failure into a sentence with its code", () => {
    expect(
      calendarFailure({ ok: false, reason: "not_configured" }),
    ).toMatchObject({
      code: "NOT_CONFIGURED",
      message: expect.stringContaining("not connected yet"),
    });
    expect(calendarFailure({ ok: false, reason: "not_found" }).code).toBe(
      "NOT_FOUND",
    );
    expect(calendarFailure({ ok: false, reason: "unavailable" }).code).toBe(
      "UNAVAILABLE",
    );
  });

  it("drops times from an all-day event's spec", () => {
    expect(
      specOf({
        title: "Trip",
        kind: "all_day",
        date: "2027-07-01",
        startTime: "10:00",
        endTime: "11:00",
        description: "",
      }),
    ).toEqual({
      title: "Trip",
      description: null,
      location: null,
      allDay: true,
      date: "2027-07-01",
      endDate: "2027-07-01",
      forMember: undefined,
    });
  });
});
