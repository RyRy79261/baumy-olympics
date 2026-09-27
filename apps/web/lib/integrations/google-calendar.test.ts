// @vitest-environment node
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_URL,
  CACHE_MS,
  CALENDAR_TIMEOUT_MS,
  MEMBER_PROPERTY,
  READ_SCOPE,
  TOKEN_URL,
  WRITE_SCOPE,
  assertionClaims,
  calendarConfig,
  eventTimes,
  failureReason,
  fromGoogle,
  googleCalendar,
  insertBody,
  patchBody,
  resetCalendarCaches,
  signAssertion,
  specInstants,
  type CalendarConfig,
  type EventSpec,
} from "./google-calendar";

// The Google Calendar client against `fetch` mocks (issue #19): the JWT
// claims and signature, the request bodies (timed, all-day, both sides of
// daylight saving), the error mapping and the read cache.

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const CONFIG: CalendarConfig = {
  calendarId: "house@group.calendar.google.com",
  clientEmail: "baumy@house.iam.gserviceaccount.com",
  privateKey,
};

const NOW = new Date("2027-01-10T12:00:00.000Z");

const dinnerJan: EventSpec = {
  title: "Dinner",
  description: null,
  location: null,
  allDay: false,
  date: "2027-01-15",
  endDate: "2027-01-15",
  startTime: "19:00",
  endTime: "20:30",
};
const dinnerJul: EventSpec = {
  ...dinnerJan,
  date: "2027-07-15",
  endDate: "2027-07-15",
};
const trip: EventSpec = {
  title: "Trip",
  description: "Pack the tent",
  location: "Lake",
  allDay: true,
  date: "2027-07-01",
  endDate: "2027-07-03",
};

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A fetch mock: the token endpoint answers, the rest goes to `route`. */
function mockFetch(route: Route, tokenStatus = 200) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init: init ?? {} });
      if (url.toString() === TOKEN_URL) {
        return tokenStatus === 200
          ? json(200, { access_token: "tok-123", expires_in: 3600 })
          : json(tokenStatus, { error: "invalid_grant" });
      }
      return route(url, init ?? {});
    },
  );
  return { fn: fn as unknown as typeof fetch, calls };
}

let nowMs = NOW.getTime();
const log = vi.fn();

function client(route: Route, tokenStatus = 200) {
  const f = mockFetch(route, tokenStatus);
  const c = googleCalendar(CONFIG, {
    fetch: f.fn,
    now: () => new Date(nowMs),
    env: { GOOGLE_CALENDAR_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n") },
    log,
  });
  return { c, calls: f.calls };
}

function apiCalls(calls: { url: URL; init: RequestInit }[]) {
  return calls.filter((c) => c.url.toString() !== TOKEN_URL);
}

function sentBody(call: { init: RequestInit }) {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

const googleDinner = {
  id: "evt00001",
  status: "confirmed",
  summary: "Dinner",
  start: { dateTime: "2027-01-15T19:00:00+01:00", timeZone: "Europe/Berlin" },
  end: { dateTime: "2027-01-15T20:30:00+01:00", timeZone: "Europe/Berlin" },
  extendedProperties: { private: { [MEMBER_PROPERTY]: "m-1" } },
};

beforeEach(() => {
  resetCalendarCaches();
  nowMs = NOW.getTime();
  log.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("calendarConfig", () => {
  it("needs all three settings, and unescapes the key's newlines", () => {
    const env = {
      GOOGLE_CALENDAR_ID: " cal@x ",
      GOOGLE_CALENDAR_CLIENT_EMAIL: "sa@x",
      GOOGLE_CALENDAR_PRIVATE_KEY: "-----BEGIN-----\\nabc\\n-----END-----",
    };
    expect(calendarConfig(env)).toEqual({
      calendarId: "cal@x",
      clientEmail: "sa@x",
      privateKey: "-----BEGIN-----\nabc\n-----END-----",
    });
    for (const drop of Object.keys(env)) {
      expect(calendarConfig({ ...env, [drop]: " " }), drop).toBeNull();
    }
    expect(calendarConfig({})).toBeNull();
  });
});

describe("the JWT", () => {
  it("claims the service account, the scope, Google's audience and one hour", () => {
    const token = signAssertion(CONFIG, WRITE_SCOPE, 1_800_000_000);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      iss: CONFIG.clientEmail,
      scope: WRITE_SCOPE,
      aud: TOKEN_URL,
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    expect(assertionClaims("a@b", READ_SCOPE, 10).scope).toBe(READ_SCOPE);
    // Signed with the account's key.
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${claims}`);
    expect(verify.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(
      true,
    );
  });

  it("is traded for a token with the read scope for reads and the write scope for writes", async () => {
    const { c, calls } = client((url, init) =>
      init.method === "POST"
        ? json(200, googleDinner)
        : json(200, { items: [] }),
    );
    await c.list({ timeMin: NOW, timeMax: new Date(NOW.getTime() + 1) });
    await c.create("evt00001", dinnerJan, "m-1");
    const tokenCalls = calls.filter((x) => x.url.toString() === TOKEN_URL);
    expect(tokenCalls).toHaveLength(2);
    const scopes = tokenCalls.map((x) => {
      const form = new URLSearchParams(String(x.init.body));
      expect(form.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      );
      const claims = form.get("assertion")!.split(".")[1]!;
      return JSON.parse(Buffer.from(claims, "base64url").toString()).scope;
    });
    expect(scopes).toEqual([READ_SCOPE, WRITE_SCOPE]);
    // Every API call carries the token and a 5s timeout.
    for (const call of apiCalls(calls)) {
      expect(new Headers(call.init.headers).get("Authorization")).toBe(
        "Bearer tok-123",
      );
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(CALENDAR_TIMEOUT_MS).toBe(5000);
  });

  it("reuses a token until a minute before it expires", async () => {
    const { c, calls } = client(() => json(200, googleDinner));
    await c.get("evt00001");
    await c.get("evt00001");
    nowMs += 3600_000 - 59_000;
    await c.get("evt00001");
    expect(calls.filter((x) => x.url.toString() === TOKEN_URL)).toHaveLength(2);
  });
});

describe("request bodies", () => {
  it("sends a timed event as local wall time with the Berlin zone, never an offset", () => {
    for (const spec of [dinnerJan, dinnerJul]) {
      const { start, end } = eventTimes(spec);
      expect(start).toEqual({
        dateTime: `${spec.date}T19:00:00`,
        timeZone: "Europe/Berlin",
      });
      expect(end).toEqual({
        dateTime: `${spec.date}T20:30:00`,
        timeZone: "Europe/Berlin",
      });
      expect(JSON.stringify({ start, end })).not.toMatch(/[+-]\d{2}:\d{2}"|Z"/);
    }
  });

  it("means 19:00 Berlin in January and in July (the DST test)", () => {
    // 19:00 Berlin is 18:00Z in winter (+01:00) and 17:00Z in summer (+02:00).
    expect(specInstants(dinnerJan).start.toISOString()).toBe(
      "2027-01-15T18:00:00.000Z",
    );
    expect(specInstants(dinnerJul).start.toISOString()).toBe(
      "2027-07-15T17:00:00.000Z",
    );
  });

  it("ends an all-day event on the day after its last (exclusive)", () => {
    expect(eventTimes(trip)).toEqual({
      start: { date: "2027-07-01" },
      end: { date: "2027-07-04" },
    });
    expect(
      eventTimes({ ...trip, endDate: "2027-12-31", date: "2027-12-31" }).end,
    ).toEqual({ date: "2028-01-01" });
    expect(specInstants(trip).end.toISOString()).toBe(
      "2027-07-03T22:00:00.000Z",
    );
  });

  it("puts the caller's id and the member on an insert", () => {
    expect(insertBody("evt00001", trip, "m-1")).toEqual({
      id: "evt00001",
      summary: "Trip",
      description: "Pack the tent",
      location: "Lake",
      start: { date: "2027-07-01" },
      end: { date: "2027-07-04" },
      extendedProperties: { private: { baumyMember: "m-1" } },
    });
    expect(insertBody("evt00001", dinnerJan, "m-1")).not.toHaveProperty(
      "description",
    );
  });

  it("clears the other time form and empty fields on a patch", () => {
    expect(patchBody(trip)).toMatchObject({
      start: { date: "2027-07-01", dateTime: null, timeZone: null },
    });
    expect(patchBody(dinnerJan)).toEqual({
      summary: "Dinner",
      description: "",
      location: "",
      start: {
        date: null,
        dateTime: "2027-01-15T19:00:00",
        timeZone: "Europe/Berlin",
      },
      end: {
        date: null,
        dateTime: "2027-01-15T20:30:00",
        timeZone: "Europe/Berlin",
      },
    });
  });
});

describe("fromGoogle", () => {
  it("reads timed and all-day events, the member and privacy", () => {
    expect(fromGoogle(googleDinner)).toEqual({
      id: "evt00001",
      title: "Dinner",
      description: null,
      location: null,
      allDay: false,
      start: "2027-01-15T18:00:00.000Z",
      end: "2027-01-15T19:30:00.000Z",
      private: false,
      member: "m-1",
    });
    expect(
      fromGoogle({
        id: "x1234",
        summary: "  ",
        visibility: "confidential",
        start: { date: "2027-07-01" },
      }),
    ).toMatchObject({
      title: "Untitled event",
      allDay: true,
      end: "2027-07-02",
      private: true,
      member: null,
    });
    expect(
      fromGoogle({ id: "x1234", start: { dateTime: "2027-01-15T19:00:00Z" } }),
    ).toMatchObject({ end: "2027-01-15T19:00:00.000Z" });
  });

  it("drops cancelled events and ones without an id or a start", () => {
    expect(fromGoogle({ ...googleDinner, status: "cancelled" })).toBeNull();
    expect(fromGoogle({ ...googleDinner, id: undefined })).toBeNull();
    expect(fromGoogle({ id: "x1234", start: {} })).toBeNull();
  });
});

describe("list", () => {
  const range = {
    timeMin: new Date("2027-01-10T23:00:00Z"),
    timeMax: new Date("2027-01-17T23:00:00Z"),
  };

  it("asks for the range, expanded and in order, and reads every page", async () => {
    const { c, calls } = client((url) =>
      url.searchParams.get("pageToken")
        ? json(200, { items: [{ ...googleDinner, id: "evt00002" }] })
        : json(200, {
            items: [googleDinner, { id: "gone1", status: "cancelled" }],
            nextPageToken: "p2",
          }),
    );
    const r = await c.list(range);
    expect(r.ok && r.data.map((e) => e.id)).toEqual(["evt00001", "evt00002"]);
    const [first] = apiCalls(calls);
    expect(first!.url.pathname).toBe(
      new URL(`${API_URL}/${encodeURIComponent(CONFIG.calendarId)}/events`)
        .pathname,
    );
    const q = first!.url.searchParams;
    expect(q.get("singleEvents")).toBe("true");
    expect(q.get("orderBy")).toBe("startTime");
    expect(q.get("timeMin")).toBe("2027-01-10T23:00:00.000Z");
    expect(q.get("timeMax")).toBe("2027-01-17T23:00:00.000Z");
    expect(q.get("timeZone")).toBe("Europe/Berlin");
  });

  it("caches a read for 5 minutes, and a write clears it", async () => {
    let served = 0;
    const { c } = client((url, init) => {
      if (init.method === "GET") served += 1;
      return init.method === "GET"
        ? json(200, { items: [googleDinner] })
        : init.method === "DELETE"
          ? new Response(null, { status: 204 })
          : json(200, googleDinner);
    });
    await c.list(range);
    await c.list(range);
    expect(served).toBe(1);

    // Each write empties the cache.
    for (const write of [
      () => c.create("evt00003", dinnerJan, "m-1"),
      () => c.update("evt00001", dinnerJan),
      () => c.delete("evt00001"),
      () => c.restore("evt00001"),
    ]) {
      await write();
      const before = served;
      await c.list(range);
      await c.list(range);
      expect(served).toBe(before + 1);
    }

    // And it runs out after CACHE_MS.
    const before = served;
    nowMs += CACHE_MS + 1;
    await c.list(range);
    expect(served).toBe(before + 1);
  });

  it("does not cache a failure", async () => {
    let status = 503;
    const { c } = client(() =>
      status === 200 ? json(200, { items: [] }) : json(status),
    );
    expect(await c.list(range)).toEqual({ ok: false, reason: "unavailable" });
    status = 200;
    expect(await c.list(range)).toEqual({ ok: true, data: [] });
  });

  it("calls a missing calendar unavailable, with a setup hint in the log", async () => {
    const { c } = client(() => json(404));
    expect(await c.list(range)).toEqual({ ok: false, reason: "unavailable" });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[calendar] list failed: HTTP 404 (check"),
    );
  });
});

describe("writes", () => {
  it("creates with POST and reads the event back", async () => {
    const { c, calls } = client(() => json(200, googleDinner));
    const r = await c.create("evt00001", dinnerJan, "m-1");
    expect(r).toMatchObject({ ok: true, data: { id: "evt00001" } });
    const [call] = apiCalls(calls);
    expect(call!.init.method).toBe("POST");
    expect(sentBody(call!)).toEqual(insertBody("evt00001", dinnerJan, "m-1"));
  });

  it("counts a 409 on create as the same create, confirming it again", async () => {
    const { c, calls } = client((_url, init) =>
      init.method === "POST" ? json(409) : json(200, googleDinner),
    );
    expect(await c.create("evt00001", dinnerJan, "m-1")).toMatchObject({
      ok: true,
      data: { id: "evt00001" },
    });
    const sent = apiCalls(calls);
    expect(sent.map((x) => x.init.method)).toEqual(["POST", "PATCH"]);
    expect(sent[1]!.url.pathname.endsWith("/events/evt00001")).toBe(true);
    // A retry after runAction's undo deleted the event brings it back.
    expect(sentBody(sent[1]!)).toEqual({
      ...patchBody(dinnerJan),
      status: "confirmed",
    });
  });

  it("updates with PATCH on the event's own URL", async () => {
    const { c, calls } = client(() => json(200, googleDinner));
    expect(await c.update("evt00001", dinnerJan)).toMatchObject({ ok: true });
    const [call] = apiCalls(calls);
    expect(call!.init.method).toBe("PATCH");
    expect(call!.url.pathname.endsWith("/events/evt00001")).toBe(true);
    expect(sentBody(call!)).toEqual(patchBody(dinnerJan));
  });

  it("restores a deleted event by confirming it", async () => {
    const { c, calls } = client(() => json(200, googleDinner));
    expect(await c.restore("evt00001")).toEqual({ ok: true, data: null });
    expect(sentBody(apiCalls(calls)[0]!)).toEqual({ status: "confirmed" });
  });

  it("counts 404 and 410 on delete as success, and anything else as unavailable", async () => {
    for (const status of [204, 404, 410]) {
      const { c } = client(() => new Response(null, { status }));
      expect(await c.delete("evt00001"), String(status)).toEqual({
        ok: true,
        data: null,
      });
    }
    const { c } = client(() => json(500));
    expect(await c.delete("evt00001")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("error mapping", () => {
  it("maps a missing event to not_found and everything else to unavailable", async () => {
    for (const [status, reason] of [
      [404, "not_found"],
      [410, "not_found"],
      [403, "unavailable"],
      [429, "unavailable"],
      [500, "unavailable"],
    ] as const) {
      const { c } = client(() => json(status));
      expect(await c.get("evt00001"), String(status)).toEqual({
        ok: false,
        reason,
      });
      expect(await c.update("evt00001", dinnerJan)).toEqual({
        ok: false,
        reason,
      });
    }
    const { c } = client(() => json(500));
    expect(await c.restore("evt00001")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(failureReason(new Error("x"))).toBe("unavailable");
  });

  it("treats a refused token as unavailable and logs its status only", async () => {
    const { c } = client(() => json(200, googleDinner), 401);
    expect(await c.get("evt00001")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(log).toHaveBeenCalledWith(
      "[calendar] get failed: HTTP 401 (check GOOGLE_CALENDAR_ID and that the calendar is shared with the service account)",
    );
    expect(String(log.mock.calls)).not.toContain("tok-123");
  });

  it("treats a token answer without a token as unavailable", async () => {
    const f = vi.fn(async () => json(200, {}));
    const c = googleCalendar(CONFIG, {
      fetch: f as unknown as typeof fetch,
      log,
    });
    expect(await c.get("evt00001")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(log).toHaveBeenCalledWith(
      "[calendar] get failed: token: no access_token",
    );
  });

  it("logs a timeout as a timeout", async () => {
    const { c } = client(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await c.list({ timeMin: NOW, timeMax: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(log).toHaveBeenCalledWith("[calendar] list failed: timed out");
  });

  it("scrubs the key from any other error, in either form", async () => {
    const { c } = client(() => {
      throw new Error(
        `bad ${privateKey} and ${privateKey.replace(/\n/g, "\\n")}`,
      );
    });
    expect(await c.delete("evt00001")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    const line = String(log.mock.calls[0]![0]);
    expect(line).toBe(
      "[calendar] delete failed: bad [redacted] and [redacted]",
    );
  });

  it("reads an answer that is not an event as gone", async () => {
    const { c } = client(() => json(200, { status: "cancelled", id: "x1234" }));
    expect(await c.get("x1234")).toEqual({ ok: false, reason: "not_found" });
  });
});
