import "server-only";

import { createSign } from "node:crypto";
import { BERLIN_TZ, addDaysToDateKey, berlinDateTimeToUtc } from "@baumy/core";
import { now as clockNow } from "@/lib/clock";
import { redactSecrets } from "@/lib/redact";

// The house's shared Google Calendar (SPEC §3.3, §6.4). Ported from camp-404
// `apps/web/lib/google-calendar.ts` and `lib/integration-config.ts`:
//
// - No SDK. A service account made for this house alone (not camp-404's)
//   signs an RS256 JWT with node:crypto and trades it for an access token.
//   Reads ask for the read-only scope; writes for the events scope.
// - Every request has a 5s timeout, and reads are cached for 5 minutes per
//   range. Any write clears the cache, so the page shows the change at once
//   (other servers keep theirs for up to 5 minutes).
// - Every call returns a result union (`ok`, `not_configured`, `unavailable`,
//   `not_found`) and never throws. A failure is logged with its HTTP status
//   only; the key, the assertion and the token never reach a log line.
// - The event id is made by the caller (lib/actions/calendar.ts), so a create
//   that timed out can still be found or deleted. Google answers 409 for an
//   id it already has: that is the same create again, and counts as done.
// - 404 and 410 on delete count as success: the event is not there, which is
//   what was wanted.
//
// Changes from camp-404:
// - A timed event is sent as a LOCAL `dateTime` ("2027-01-15T19:00:00")
//   without an offset, plus `timeZone: "Europe/Berlin"`, so Google applies
//   the right offset for that day. camp-404 hard-codes `+02:00`, which is
//   wrong for half the year in Berlin. An all-day event's end date is
//   exclusive, as Google's is.
// - The member who made the event is kept in
//   `extendedProperties.private.baumyMember`, and the member it is for
//   (issue #134) in `baumyFor`: an empty string, or no key, is the house.
// - Updates use PATCH.

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const API_URL = "https://www.googleapis.com/calendar/v3/calendars";
/** What reads ask for: the events, and nothing they could change. */
export const READ_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
/** What writes ask for. */
export const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** The private extended property that names the member who made an event. */
export const MEMBER_PROPERTY = "baumyMember";
/** The private extended property that names the member an event is for. */
export const FOR_PROPERTY = "baumyFor";
/** How long each Google request may take. */
export const CALENDAR_TIMEOUT_MS = 5000;
/** How long one read is reused, per server instance. */
export const CACHE_MS = 5 * 60 * 1000;
/** Google's largest page; a house calendar month fits in one. */
const PAGE_SIZE = 250;
/** Pages followed for one read at most. */
const MAX_PAGES = 4;
/** Ranges kept in the read cache at most. */
const CACHE_ENTRIES = 50;

// --- Results and shapes ------------------------------------------------------

export type CalendarFailureReason =
  "not_configured" | "unavailable" | "not_found";

export interface CalendarFailure {
  ok: false;
  reason: CalendarFailureReason;
}

export type CalendarResult<T> = { ok: true; data: T } | CalendarFailure;

/** An event as the app uses it. */
export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** All-day: the first day, "YYYY-MM-DD". Timed: an ISO instant (UTC). */
  start: string;
  /** All-day: the day AFTER the last one (Google's exclusive end). Timed: an ISO instant. */
  end: string;
  /** Marked private or confidential in Google. The app never shows these. */
  private: boolean;
  /** The member who made it in the app, or null. */
  member: string | null;
  /** The member it is for, or null for the whole house. */
  forMember: string | null;
}

/** What the app writes: Berlin days and wall-clock times. */
export interface EventSpec {
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** The first day, "YYYY-MM-DD". */
  date: string;
  /** The last day, inclusive. */
  endDate: string;
  /** Timed only: "HH:MM" on `date`. */
  startTime?: string;
  /** Timed only: "HH:MM" on `endDate`. */
  endTime?: string;
  /**
   * The member it is for, or null for the whole house. Undefined on an
   * update keeps who it is for (the PATCH leaves `baumyFor` alone).
   */
  forMember?: string | null;
}

/** A half-open range of instants. */
export interface TimeRange {
  timeMin: Date;
  timeMax: Date;
}

/** The calendar, whichever one this environment talks to. */
export interface CalendarClient {
  /** Events overlapping the range, soonest first, recurring ones expanded. */
  list(range: TimeRange): Promise<CalendarResult<CalendarEvent[]>>;
  get(eventId: string): Promise<CalendarResult<CalendarEvent>>;
  /** Insert with the caller's id; the same id again returns the event. */
  create(
    eventId: string,
    spec: EventSpec,
    memberId: string,
  ): Promise<CalendarResult<CalendarEvent>>;
  /** PATCH the event's title, notes, place and times. */
  update(
    eventId: string,
    spec: EventSpec,
  ): Promise<CalendarResult<CalendarEvent>>;
  /** Gone already (404, 410) counts as done. */
  delete(eventId: string): Promise<CalendarResult<null>>;
  /** Bring a deleted event back (the undo of a delete). */
  restore(eventId: string): Promise<CalendarResult<null>>;
}

// --- Configuration (camp-404 lib/integration-config.ts) --------------------

export type EnvBag = Readonly<Record<string, string | undefined>>;

export interface CalendarConfig {
  calendarId: string;
  clientEmail: string;
  privateKey: string;
}

/** The calendar and the account that writes it, or null when any is unset. */
export function calendarConfig(env: EnvBag): CalendarConfig | null {
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  const clientEmail = env.GOOGLE_CALENDAR_CLIENT_EMAIL?.trim();
  const rawKey = env.GOOGLE_CALENDAR_PRIVATE_KEY;
  if (!calendarId || !clientEmail || !rawKey?.trim()) return null;
  // Env stores the PEM with literal `\n`; signing needs real newlines.
  return { calendarId, clientEmail, privateKey: rawKey.replace(/\\n/g, "\n") };
}

// --- The JWT ---------------------------------------------------------------

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** The claims of the service-account assertion. */
export function assertionClaims(
  clientEmail: string,
  scope: string,
  nowSeconds: number,
) {
  return {
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
}

/** The signed assertion Google trades for an access token. */
export function signAssertion(
  config: Pick<CalendarConfig, "clientEmail" | "privateKey">,
  scope: string,
  nowSeconds: number,
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify(assertionClaims(config.clientEmail, scope, nowSeconds)),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(config.privateKey).toString("base64url")}`;
}

// --- Request bodies ----------------------------------------------------------

type GoogleTime =
  | { date: string }
  | { dateTime: string; timeZone: string }
  | { date: string; dateTime: null; timeZone: null }
  | { date: null; dateTime: string; timeZone: string };

/**
 * Start and end as Google takes them. Timed: a local `dateTime` with NO
 * offset and the Berlin zone, so 19:00 stays 19:00 in January and in July.
 * All-day: `date`, with the end the day after the last (exclusive).
 * `clearOther` adds nulls for the other form, which a PATCH needs to switch
 * an event between timed and all-day.
 */
export function eventTimes(
  spec: EventSpec,
  clearOther = false,
): { start: GoogleTime; end: GoogleTime } {
  if (spec.allDay) {
    const day = (date: string): GoogleTime =>
      clearOther ? { date, dateTime: null, timeZone: null } : { date };
    return {
      start: day(spec.date),
      end: day(addDaysToDateKey(spec.endDate, 1)),
    };
  }
  const at = (date: string, time: string): GoogleTime => {
    const local = { dateTime: `${date}T${time}:00`, timeZone: BERLIN_TZ };
    return clearOther ? { date: null, ...local } : local;
  };
  return {
    start: at(spec.date, spec.startTime ?? "00:00"),
    end: at(spec.endDate, spec.endTime ?? spec.startTime ?? "00:00"),
  };
}

/** The events.insert body. */
export function insertBody(eventId: string, spec: EventSpec, memberId: string) {
  return {
    id: eventId,
    summary: spec.title,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.location ? { location: spec.location } : {}),
    ...eventTimes(spec),
    extendedProperties: {
      private: {
        [MEMBER_PROPERTY]: memberId,
        ...(spec.forMember ? { [FOR_PROPERTY]: spec.forMember } : {}),
      },
    },
  };
}

/**
 * The body that makes an id Google already holds (a create retried, maybe
 * after its undo deleted it) into the event asked for, confirmed again.
 */
export function resurrectBody(spec: EventSpec) {
  return {
    ...patchBody({ ...spec, forMember: spec.forMember ?? null }),
    status: "confirmed" as const,
  };
}

/**
 * The events.patch body: every field the sheet edits, cleared when empty.
 * Google merges `extendedProperties.private` key by key, so this sets who it
 * is for ("" for the house) and leaves who made it alone; with `forMember`
 * undefined it sends no key, and who it is for stays as it was.
 */
export function patchBody(spec: EventSpec): {
  summary: string;
  description: string;
  location: string;
  start: GoogleTime;
  end: GoogleTime;
  extendedProperties?: { private: Record<string, string> };
} {
  return {
    summary: spec.title,
    description: spec.description ?? "",
    location: spec.location ?? "",
    ...eventTimes(spec, true),
    ...(spec.forMember === undefined
      ? {}
      : {
          extendedProperties: {
            private: { [FOR_PROPERTY]: spec.forMember ?? "" },
          },
        }),
  };
}

// --- Reading Google's answer -------------------------------------------------

/** The fields of a Google event the app reads. */
export interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  visibility?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string | undefined> };
}

export const EVENT_FIELDS =
  "id,status,summary,description,location,visibility,start,end,extendedProperties/private";

/** One Google event as the app's, or null for a cancelled or broken one. */
export function fromGoogle(item: GoogleEvent): CalendarEvent | null {
  if (!item.id || item.status === "cancelled") return null;
  const allDay = Boolean(item.start?.date);
  let start: string;
  let end: string;
  if (allDay) {
    start = item.start!.date!;
    end = item.end?.date ?? addDaysToDateKey(start, 1);
  } else {
    const s = Date.parse(item.start?.dateTime ?? "");
    if (Number.isNaN(s)) return null;
    const e = Date.parse(item.end?.dateTime ?? "");
    start = new Date(s).toISOString();
    end = new Date(Number.isNaN(e) ? s : e).toISOString();
  }
  return {
    id: item.id,
    title: item.summary?.trim() || "Untitled event",
    description: item.description?.trim() || null,
    location: item.location?.trim() || null,
    allDay,
    start,
    end,
    private:
      item.visibility === "private" || item.visibility === "confidential",
    member: item.extendedProperties?.private?.[MEMBER_PROPERTY]?.trim() || null,
    forMember: item.extendedProperties?.private?.[FOR_PROPERTY]?.trim() || null,
  };
}

/** A spec's instants, for the fake and for tests: [start, end). */
export function specInstants(spec: EventSpec): { start: Date; end: Date } {
  if (spec.allDay) {
    return {
      start: berlinDateTimeToUtc(spec.date),
      end: berlinDateTimeToUtc(addDaysToDateKey(spec.endDate, 1)),
    };
  }
  return {
    start: berlinDateTimeToUtc(spec.date, spec.startTime),
    end: berlinDateTimeToUtc(spec.endDate, spec.endTime),
  };
}

// --- Caches (per server, shared by every route bundle) ---------------------

const CACHE_KEY = Symbol.for("baumy.calendar.cache");
type Caches = {
  reads: Map<string, { at: number; events: CalendarEvent[] }>;
  tokens: Map<string, { token: string; expiresAt: number }>;
};
type CacheGlobal = typeof globalThis & { [CACHE_KEY]?: Caches };

function caches(): Caches {
  return ((globalThis as CacheGlobal)[CACHE_KEY] ??= {
    reads: new Map(),
    tokens: new Map(),
  });
}

/** Forget cached reads, so the next read shows a write. */
export function forgetCalendarReads(): void {
  caches().reads.clear();
}

/** Tests: forget reads and tokens. */
export function resetCalendarCaches(): void {
  caches().reads.clear();
  caches().tokens.clear();
}

// --- The client ----------------------------------------------------------------

export interface GoogleCalendarDeps {
  fetch: typeof fetch;
  now: () => Date;
  timeoutMs: number;
  /** For scrubbing log lines. */
  env: EnvBag;
  log: (line: string) => void;
}

/** A failed request: the HTTP status and nothing else. */
class HttpError extends Error {
  constructor(
    readonly op: string,
    readonly status: number,
  ) {
    super(`${op} ${status}`);
  }
}

/** The reason a failed call reports. Only a missing event is not_found. */
export function failureReason(error: unknown): "unavailable" | "not_found" {
  return error instanceof HttpError &&
    (error.status === 404 || error.status === 410)
    ? "not_found"
    : "unavailable";
}

/** The real calendar. */
export function googleCalendar(
  config: CalendarConfig,
  deps: Partial<GoogleCalendarDeps> = {},
): CalendarClient {
  const d: GoogleCalendarDeps = {
    fetch: deps.fetch ?? ((...a) => fetch(...a)),
    now: deps.now ?? clockNow,
    timeoutMs: deps.timeoutMs ?? CALENDAR_TIMEOUT_MS,
    env: deps.env ?? process.env,
    log: deps.log ?? ((line) => console.error(line)),
  };

  /** One loggable line: our errors carry a status; others are scrubbed. */
  function logFailure(op: string, error: unknown): void {
    let text: string;
    if (error instanceof HttpError) {
      text = `HTTP ${error.status}`;
      if ([401, 403, 404].includes(error.status)) {
        text +=
          " (check GOOGLE_CALENDAR_ID and that the calendar is shared with the service account)";
      }
    } else if (error instanceof Error && error.name === "TimeoutError") {
      text = "timed out";
    } else {
      const message = error instanceof Error ? error.message : String(error);
      // The key as the signer uses it has real newlines, which the env's
      // escaped form does not match.
      text = redactSecrets(message, d.env)
        .split(config.privateKey)
        .join("[redacted]");
    }
    d.log(`[calendar] ${op} failed: ${text}`);
  }

  async function accessToken(scope: string): Promise<string> {
    const nowMs = d.now().getTime();
    const hit = caches().tokens.get(`${config.clientEmail}|${scope}`);
    if (hit && hit.expiresAt > nowMs) return hit.token;
    const res = await d.fetch(TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(d.timeoutMs),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signAssertion(config, scope, Math.floor(nowMs / 1000)),
      }),
    });
    if (!res.ok) throw new HttpError("token", res.status);
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) throw new Error("token: no access_token");
    // Reused until a minute before it expires.
    const ttl = Math.max(0, (body.expires_in ?? 3600) - 60) * 1000;
    caches().tokens.set(`${config.clientEmail}|${scope}`, {
      token: body.access_token,
      expiresAt: nowMs + ttl,
    });
    return body.access_token;
  }

  function eventsUrl(eventId?: string): URL {
    const base = `${API_URL}/${encodeURIComponent(config.calendarId)}/events`;
    return new URL(eventId ? `${base}/${encodeURIComponent(eventId)}` : base);
  }

  async function call(
    op: string,
    scope: string,
    method: string,
    url: URL,
    body?: unknown,
  ): Promise<Response> {
    const token = await accessToken(scope);
    const res = await d.fetch(url, {
      method,
      signal: AbortSignal.timeout(d.timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return res;
  }

  async function readEvent(op: string, res: Response): Promise<CalendarEvent> {
    if (!res.ok) throw new HttpError(op, res.status);
    const event = fromGoogle((await res.json()) as GoogleEvent);
    if (!event) throw new HttpError(op, 410);
    return event;
  }

  /**
   * Run one call, turning any failure into a reason. `missingIsFailure`: a
   * 404 means the calendar itself is missing (a wrong id, or not shared), a
   * setup problem rather than a missing event.
   */
  async function guarded<T>(
    op: string,
    fn: () => Promise<T>,
    missingIsFailure = false,
  ): Promise<CalendarResult<T>> {
    try {
      return { ok: true, data: await fn() };
    } catch (error) {
      const reason = missingIsFailure ? "unavailable" : failureReason(error);
      if (reason === "unavailable") logFailure(op, error);
      return { ok: false, reason };
    }
  }

  async function get(eventId: string): Promise<CalendarEvent> {
    const url = eventsUrl(eventId);
    url.searchParams.set("fields", EVENT_FIELDS);
    return readEvent("get", await call("get", READ_SCOPE, "GET", url));
  }

  return {
    async list(range) {
      const key = `${range.timeMin.toISOString()}|${range.timeMax.toISOString()}`;
      const nowMs = d.now().getTime();
      const hit = caches().reads.get(key);
      if (hit && nowMs - hit.at < CACHE_MS)
        return { ok: true, data: hit.events };
      const result = await guarded(
        "list",
        async () => {
          const events: CalendarEvent[] = [];
          let pageToken: string | undefined;
          for (let page = 0; page < MAX_PAGES; page += 1) {
            const url = eventsUrl();
            url.searchParams.set("singleEvents", "true");
            url.searchParams.set("orderBy", "startTime");
            url.searchParams.set("timeMin", range.timeMin.toISOString());
            url.searchParams.set("timeMax", range.timeMax.toISOString());
            url.searchParams.set("timeZone", BERLIN_TZ);
            url.searchParams.set("maxResults", String(PAGE_SIZE));
            url.searchParams.set(
              "fields",
              `nextPageToken,items(${EVENT_FIELDS})`,
            );
            if (pageToken) url.searchParams.set("pageToken", pageToken);
            const res = await call("list", READ_SCOPE, "GET", url);
            if (!res.ok) throw new HttpError("list", res.status);
            const body = (await res.json()) as {
              items?: GoogleEvent[];
              nextPageToken?: string;
            };
            for (const item of body.items ?? []) {
              const event = fromGoogle(item);
              if (event) events.push(event);
            }
            pageToken = body.nextPageToken;
            if (!pageToken) break;
          }
          return events;
        },
        true,
      );
      if (result.ok) {
        const reads = caches().reads;
        if (reads.size >= CACHE_ENTRIES) {
          reads.delete(reads.keys().next().value!);
        }
        reads.set(key, { at: nowMs, events: result.data });
      }
      return result;
    },

    get: (eventId) => guarded("get", () => get(eventId)),

    async create(eventId, spec, memberId) {
      forgetCalendarReads();
      const result = await guarded("create", async () => {
        const res = await call(
          "create",
          WRITE_SCOPE,
          "POST",
          eventsUrl(),
          insertBody(eventId, spec, memberId),
        );
        // 409: Google already has this id, from an earlier try of this very
        // create (the id is made from the request id). Its answer may have
        // been lost, or runAction may have undone it (deleted it) when the
        // audit failed; Google keeps a deleted id, so a plain read would
        // find it cancelled for good. PATCH it to the fields asked for and
        // confirmed, which is the same create done, whichever it was.
        if (res.status === 409) {
          const url = eventsUrl(eventId);
          url.searchParams.set("fields", EVENT_FIELDS);
          return readEvent(
            "create",
            await call(
              "create",
              WRITE_SCOPE,
              "PATCH",
              url,
              resurrectBody(spec),
            ),
          );
        }
        return readEvent("create", res);
      });
      forgetCalendarReads();
      return result;
    },

    async update(eventId, spec) {
      forgetCalendarReads();
      const result = await guarded("update", async () => {
        const url = eventsUrl(eventId);
        url.searchParams.set("fields", EVENT_FIELDS);
        const res = await call(
          "update",
          WRITE_SCOPE,
          "PATCH",
          url,
          patchBody(spec),
        );
        return readEvent("update", res);
      });
      forgetCalendarReads();
      return result;
    },

    async delete(eventId) {
      forgetCalendarReads();
      const result = await guarded("delete", async () => {
        const res = await call(
          "delete",
          WRITE_SCOPE,
          "DELETE",
          eventsUrl(eventId),
        );
        // 404 or 410: it is not there, which is what was wanted.
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          throw new HttpError("delete", res.status);
        }
        return null;
      });
      forgetCalendarReads();
      return result;
    },

    async restore(eventId) {
      forgetCalendarReads();
      const result = await guarded("restore", async () => {
        // A deleted event stays in Google as `cancelled`; confirming it
        // brings it back with its id.
        const res = await call(
          "restore",
          WRITE_SCOPE,
          "PATCH",
          eventsUrl(eventId),
          { status: "confirmed" },
        );
        if (!res.ok) throw new HttpError("restore", res.status);
        return null;
      });
      forgetCalendarReads();
      return result;
    },
  };
}
