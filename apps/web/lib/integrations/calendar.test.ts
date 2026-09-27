// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  calendarClient,
  setCalendarClientForTests,
  unconfiguredCalendar,
} from "./calendar";
import {
  clearMemoryCalendar,
  memoryCalendar,
  seedMemoryEvent,
} from "./calendar-memory";
import type { EventSpec } from "./google-calendar";

// Which calendar each environment gets, and the E2E fake, which must answer
// the real client's bodies the way Google does.

const at19 = (date: string): EventSpec => ({
  title: "Dinner",
  description: "Bring wine",
  location: null,
  allDay: false,
  date,
  endDate: date,
  startTime: "19:00",
  endTime: "20:00",
});

beforeEach(() => clearMemoryCalendar());
afterEach(() => setCalendarClientForTests(null));

describe("calendarClient", () => {
  const configured = {
    GOOGLE_CALENDAR_ID: "cal@x",
    GOOGLE_CALENDAR_CLIENT_EMAIL: "sa@x",
    GOOGLE_CALENDAR_PRIVATE_KEY: "not-a-key",
  };

  it("is not configured without credentials, and says so for every call", async () => {
    const c = calendarClient({});
    expect(c).toBe(unconfiguredCalendar);
    const nc = { ok: false, reason: "not_configured" };
    expect(await c.list({ timeMin: new Date(), timeMax: new Date() })).toEqual(
      nc,
    );
    expect(await c.get("x1234")).toEqual(nc);
    expect(await c.create("x1234", at19("2027-01-15"), "m")).toEqual(nc);
    expect(await c.update("x1234", at19("2027-01-15"))).toEqual(nc);
    expect(await c.delete("x1234")).toEqual(nc);
    expect(await c.restore("x1234")).toEqual(nc);
  });

  it("is Google with credentials, the fake in E2E test mode, or the test override", async () => {
    const google = calendarClient(configured);
    expect(google).not.toBe(unconfiguredCalendar);
    // A key that cannot sign fails closed as unavailable, never a throw.
    expect(await google.get("x1234")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    const fake = calendarClient({ ...configured, E2E_TEST_MODE: "1" });
    expect(await fake.create("x1234", at19("2027-01-15"), "m")).toMatchObject({
      ok: true,
    });
    setCalendarClientForTests(unconfiguredCalendar);
    expect(calendarClient(configured)).toBe(unconfiguredCalendar);
  });
});

describe("the fake calendar", () => {
  it("reads 19:00 Berlin as 19:00 in January and in July", async () => {
    const c = memoryCalendar();
    const jan = await c.create("jan00001", at19("2027-01-15"), "m-1");
    const jul = await c.create("jul00001", at19("2027-07-15"), "m-1");
    expect(jan).toMatchObject({
      ok: true,
      data: {
        start: "2027-01-15T18:00:00.000Z",
        member: "m-1",
        description: "Bring wine",
      },
    });
    expect(jul).toMatchObject({
      ok: true,
      data: { start: "2027-07-15T17:00:00.000Z" },
    });
  });

  it("answers the same id again like the client's 409: confirmed, as asked", async () => {
    const c = memoryCalendar();
    await c.create("evt00001", at19("2027-01-15"), "m-1");
    const again = await c.create("evt00001", at19("2027-01-15"), "m-1");
    expect(again).toMatchObject({
      ok: true,
      data: { title: "Dinner", member: "m-1" },
    });
    // Deleted (an undo), then the same create again: it comes back.
    await c.delete("evt00001");
    expect(await c.create("evt00001", at19("2027-01-15"), "m-1")).toMatchObject(
      { ok: true, data: { id: "evt00001", title: "Dinner" } },
    );
    expect(await c.get("evt00001")).toMatchObject({ ok: true });
  });

  it("lists what overlaps the range, soonest first, all-day by Berlin days", async () => {
    const c = memoryCalendar();
    await c.create("late0001", at19("2027-01-16"), "m");
    await c.create("early001", at19("2027-01-15"), "m");
    await c.create(
      "allday01",
      {
        ...at19("2027-01-15"),
        allDay: true,
        startTime: undefined,
        endTime: undefined,
      },
      "m",
    );
    await c.create("other001", at19("2027-02-01"), "m");
    // 15 Jan 00:00 Berlin to 17 Jan 00:00 Berlin.
    const r = await c.list({
      timeMin: new Date("2027-01-14T23:00:00Z"),
      timeMax: new Date("2027-01-16T23:00:00Z"),
    });
    expect(r.ok && r.data.map((e) => e.id)).toEqual([
      "allday01",
      "early001",
      "late0001",
    ]);
  });

  it("updates, deletes and restores, and a missing event is not found", async () => {
    const c = memoryCalendar();
    await c.create("evt00001", at19("2027-01-15"), "m-1");
    const moved = await c.update("evt00001", {
      ...at19("2027-01-15"),
      description: null,
      location: "Kitchen",
      allDay: true,
    });
    expect(moved).toMatchObject({
      ok: true,
      data: {
        allDay: true,
        start: "2027-01-15",
        end: "2027-01-16",
        description: null,
        location: "Kitchen",
        member: "m-1",
      },
    });
    expect(await c.delete("evt00001")).toEqual({ ok: true, data: null });
    expect(await c.delete("evt00001")).toEqual({ ok: true, data: null });
    expect(await c.get("evt00001")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await c.update("evt00001", at19("2027-01-15"))).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await c.restore("evt00001")).toEqual({ ok: true, data: null });
    expect(await c.get("evt00001")).toMatchObject({ ok: true });
    expect(await c.restore("nothing1")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("keeps events seeded as if made in Google, private ones included", async () => {
    seedMemoryEvent({
      id: "priv0001",
      summary: "Doctor",
      visibility: "private",
      start: { dateTime: "2027-01-15T09:00:00Z" },
      end: { dateTime: "2027-01-15T10:00:00Z" },
    });
    expect(await memoryCalendar().get("priv0001")).toMatchObject({
      ok: true,
      data: { private: true, member: null },
    });
  });

  it("refuses a time the real client would never send", async () => {
    await expect(
      memoryCalendar().create(
        "bad00001",
        { ...at19("2027-01-15"), startTime: "7pm" },
        "m",
      ),
    ).rejects.toThrow(/unexpected time/);
  });
});
