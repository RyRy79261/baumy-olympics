import "server-only";

import { BERLIN_TZ, berlinDateTimeToUtc } from "@baumy/core";
import {
  fromGoogle,
  insertBody,
  patchBody,
  type CalendarClient,
  type CalendarEvent,
  type GoogleEvent,
} from "./google-calendar";

// The E2E fake calendar (SPEC §10): an in-memory Google Calendar for
// E2E_TEST_MODE=1. It takes the SAME request bodies the real client sends
// (insertBody, patchBody) and answers like Google: a local `dateTime` with
// `timeZone: "Europe/Berlin"` is read as Berlin wall time for that day, and
// comes back as an instant with its offset. So a spec that creates 19:00 in
// January and in July sees 19:00 both times only if the bodies are right.
//
// It lives on globalThis because Next can load this module once per route
// bundle, and the page and the server action must see one calendar (the same
// reason as lib/clock.ts). Specs run in parallel against it, so they use
// titles of their own.

const STORE_KEY = Symbol.for("baumy.calendar.memory");
type StoreGlobal = typeof globalThis & {
  [STORE_KEY]?: Map<string, GoogleEvent>;
};

function store(): Map<string, GoogleEvent> {
  return ((globalThis as StoreGlobal)[STORE_KEY] ??= new Map());
}

/** Tests: an empty calendar. */
export function clearMemoryCalendar(): void {
  store().clear();
}

/** Tests and specs: put an event in as if made in Google itself. */
export function seedMemoryEvent(event: GoogleEvent & { id: string }): void {
  store().set(event.id, structuredClone(event));
}

type SentTime = {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
};

/** What Google stores for a sent start or end. */
function stored(t: SentTime): { date?: string; dateTime?: string } {
  if (t.date) return { date: t.date };
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00$/.exec(t.dateTime ?? "");
  if (!local || t.timeZone !== BERLIN_TZ) {
    // The real client never sends anything else; fail loudly if it does.
    throw new Error(`fake calendar: unexpected time ${JSON.stringify(t)}`);
  }
  return {
    dateTime: berlinDateTimeToUtc(local[1]!, local[2]!).toISOString(),
  };
}

function live(id: string): GoogleEvent | undefined {
  const e = store().get(id);
  return e && e.status !== "cancelled" ? e : undefined;
}

function read(e: GoogleEvent): CalendarEvent {
  return fromGoogle(e)!;
}

const NOT_FOUND = { ok: false, reason: "not_found" } as const;

/** The fake calendar. */
export function memoryCalendar(): CalendarClient {
  return {
    async list({ timeMin, timeMax }) {
      const events = [...store().values()]
        .map((e) => fromGoogle(e))
        .filter((e): e is CalendarEvent => e !== null)
        .filter((e) => {
          const start = e.allDay
            ? berlinDateTimeToUtc(e.start).getTime()
            : Date.parse(e.start);
          const end = e.allDay
            ? berlinDateTimeToUtc(e.end).getTime()
            : Date.parse(e.end);
          return start < timeMax.getTime() && end > timeMin.getTime();
        })
        .sort((a, b) =>
          (a.allDay ? berlinDateTimeToUtc(a.start).toISOString() : a.start) <
          (b.allDay ? berlinDateTimeToUtc(b.start).toISOString() : b.start)
            ? -1
            : 1,
        );
      return { ok: true, data: events };
    },
    async get(eventId) {
      const e = live(eventId);
      return e ? { ok: true, data: read(e) } : NOT_FOUND;
    },
    async create(eventId, spec, memberId) {
      const existing = store().get(eventId);
      // Google keeps a used id, even after a delete (409).
      if (existing) {
        return existing.status === "cancelled"
          ? { ok: false, reason: "unavailable" }
          : { ok: true, data: read(existing) };
      }
      const body = insertBody(eventId, spec, memberId);
      const event: GoogleEvent = {
        ...body,
        status: "confirmed",
        start: stored(body.start),
        end: stored(body.end),
      };
      store().set(eventId, event);
      return { ok: true, data: read(event) };
    },
    async update(eventId, spec) {
      const e = live(eventId);
      if (!e) return NOT_FOUND;
      const body = patchBody(spec);
      const next: GoogleEvent = {
        ...e,
        summary: body.summary,
        description: body.description || undefined,
        location: body.location || undefined,
        start: stored(body.start),
        end: stored(body.end),
      };
      store().set(eventId, next);
      return { ok: true, data: read(next) };
    },
    async delete(eventId) {
      const e = store().get(eventId);
      if (e) store().set(eventId, { ...e, status: "cancelled" });
      return { ok: true, data: null };
    },
    async restore(eventId) {
      const e = store().get(eventId);
      if (!e) return NOT_FOUND;
      store().set(eventId, { ...e, status: "confirmed" });
      return { ok: true, data: null };
    },
  };
}
