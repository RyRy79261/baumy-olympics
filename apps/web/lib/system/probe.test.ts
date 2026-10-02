// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setBrainClientForTests,
  unconfiguredBrain,
  type BrainClient,
} from "@/lib/integrations/brain";
import { setCalendarClientForTests } from "@/lib/integrations/calendar";
import { probeAll, getSystemStatus, type ProbeDeps } from "./probe";

// The live half of the status page (issue #133). The promise first: no
// secret ever reaches the page. Every setting holds a marker, every service
// fails while quoting it back, and no marker may survive into any string the
// page can show.

const MARKER = "zzBAUMY-SECRET-MARKERzz";

/** Every setting the page reads, each carrying the marker. */
function secretEnv(): Record<string, string> {
  return {
    DATABASE_URL: `postgres://owner:${MARKER}@ep-x.neon.tech/db`,
    DATABASE_URL_UNPOOLED: `postgres://owner:${MARKER}@ep-y.neon.tech/db`,
    RESEND_API_KEY: `re_${MARKER}`,
    RESEND_FROM_EMAIL: `${MARKER}@example.com`,
    BRAIN_BASE_URL: "https://brain.example.com",
    KITCHEN_API_TOKEN: `kt_${MARKER}`,
    GOOGLE_CALENDAR_ID: `${MARKER}@group.calendar.google.com`,
    GOOGLE_CALENDAR_CLIENT_EMAIL: `${MARKER}@iam.gserviceaccount.com`,
    GOOGLE_CALENDAR_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----${MARKER}`,
    ANTHROPIC_API_KEY: `sk-ant-${MARKER}`,
    GROQ_API_KEY: `gsk_${MARKER}`,
    BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${MARKER}`,
    GITHUB_FEEDBACK_TOKEN: `ghp_${MARKER}`,
    GITHUB_FEEDBACK_REPO: "RyRy79261/baumy-olympics",
  };
}

const quotingBrain: BrainClient = {
  ...unconfiguredBrain,
  listShopping: async () => {
    throw new Error(`brain refused token kt_${MARKER}`);
  },
};

function deps(overrides: Partial<ProbeDeps> = {}): ProbeDeps {
  let t = 0;
  return {
    env: secretEnv(),
    fetch: async () => new Response(`{"error":"${MARKER}"}`, { status: 401 }),
    queryDb: async () => {
      throw new Error(`connect failed: ${secretEnv().DATABASE_URL}`);
    },
    clock: () => (t += 5),
    timeoutMs: 1000,
    ...overrides,
  };
}

afterEach(() => {
  setBrainClientForTests(null);
  setCalendarClientForTests(null);
});

describe("the system status never shows a secret", () => {
  it("leaves no marker in any string, whatever the services answer", async () => {
    setBrainClientForTests(quotingBrain);
    setCalendarClientForTests({
      list: async () => ({ ok: false, reason: "unavailable" }),
    } as never);
    const status = await getSystemStatus(deps());
    const strings = [
      status.headline.summary,
      ...status.checks.flatMap((c) => [c.id, c.label, c.detail, ...c.env]),
    ];
    // Present before absent: the page did say things, and named the vars.
    expect(strings.join(" ")).toContain("GITHUB_FEEDBACK_TOKEN");
    expect(strings.join(" ")).toContain("It answered 401 (key refused).");
    for (const s of strings) expect(s).not.toContain(MARKER);
  });
});

describe("probeAll", () => {
  it("asks each service once, cheaply, and times it", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const queryDb = vi.fn(async () => [{ "?column?": 1 }]);
    setBrainClientForTests({
      ...unconfiguredBrain,
      listShopping: async () => ({ ok: true, data: [] }),
    });
    setCalendarClientForTests({
      list: async () => ({ ok: true, data: [] }),
    } as never);
    const p = await probeAll(deps({ fetch: fetchImpl, queryDb }));
    expect(p.database).toEqual({
      configured: true,
      reach: { kind: "ok", latencyMs: expect.any(Number) },
    });
    for (const id of ["brain", "calendar", "claude", "groq"] as const) {
      expect(p[id]).toMatchObject({ configured: true, reach: { kind: "ok" } });
    }
    expect(p.bugReports).toMatchObject({
      configured: true,
      problem: null,
      repo: "RyRy79261/baumy-olympics",
      reach: { kind: "ok" },
    });
    // Resend and Blob are never called.
    expect(p.email).toEqual({
      configured: true,
      reach: { kind: "not_checked" },
    });
    expect(p.blob).toEqual({
      configured: true,
      reach: { kind: "not_checked" },
    });
    const urls = fetchImpl.mock.calls.map((c) => (c as unknown[])[0]);
    expect(urls).toEqual([
      "https://api.anthropic.com/v1/models?limit=1",
      "https://api.groq.com/openai/v1/models",
      "https://api.github.com/repos/RyRy79261/baumy-olympics",
    ]);
    for (const call of fetchImpl.mock.calls) {
      expect((call as unknown as [string, RequestInit])[1].method).toBe("GET");
    }
    expect(queryDb).toHaveBeenCalledOnce();
  });

  it("checks nothing that is not set up", async () => {
    const fetchImpl = vi.fn();
    const p = await probeAll(
      deps({ env: { GITHUB_FEEDBACK_TOKEN: "t", GITHUB_FEEDBACK_REPO: "x" }, fetch: fetchImpl }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const id of [
      "database",
      "email",
      "brain",
      "calendar",
      "claude",
      "groq",
      "blob",
    ] as const) {
      expect(p[id]).toEqual({
        configured: false,
        reach: { kind: "not_checked" },
      });
    }
    expect(p.bugReports).toMatchObject({
      configured: false,
      problem: "bad_repo",
      repo: null,
    });
  });

  it("counts a service that hangs as a timeout, and a refused key as refused", async () => {
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener("abort", () => reject(new Error("x"))),
      );
    const p = await probeAll(
      deps({
        env: { ANTHROPIC_API_KEY: "k" },
        fetch: hanging,
        timeoutMs: 5,
      }),
    );
    expect(p.claude.reach).toEqual({ kind: "failed", reason: "timeout" });

    const refused = await probeAll(
      deps({
        env: { GROQ_API_KEY: "k", ANTHROPIC_API_KEY: "k" },
        fetch: async (url) =>
          new Response("{}", { status: url.includes("groq") ? 403 : 503 }),
      }),
    );
    expect(refused.groq.reach).toEqual({
      kind: "failed",
      status: 403,
      reason: "key refused",
    });
    expect(refused.claude.reach).toEqual({
      kind: "failed",
      status: 503,
      reason: "error",
    });
  });

  it("calls no outside service in test mode, and says a fake stands in", async () => {
    const fetchImpl = vi.fn();
    const queryDb = vi.fn(async () => []);
    const p = await probeAll(
      deps({
        env: { E2E_TEST_MODE: "1", DATABASE_URL: "postgres://localhost/x" },
        fetch: fetchImpl,
        queryDb,
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(p.database.reach.kind).toBe("ok");
    for (const id of [
      "brain",
      "calendar",
      "claude",
      "groq",
      "blob",
      "bugReports",
    ] as const) {
      expect(p[id]).toMatchObject({ configured: true, reach: { kind: "fake" } });
    }
  });

  it("reads a brain or calendar failure as its reason", async () => {
    const env = {
      BRAIN_BASE_URL: "https://brain.example.com",
      KITCHEN_API_TOKEN: "t",
      GOOGLE_CALENDAR_ID: "c",
      GOOGLE_CALENDAR_CLIENT_EMAIL: "e",
      GOOGLE_CALENDAR_PRIVATE_KEY: "k",
    };
    setBrainClientForTests({
      ...unconfiguredBrain,
      listShopping: async () => ({ ok: false, reason: "unavailable" }),
    });
    setCalendarClientForTests({
      list: async () => ({ ok: false, reason: "not_found" }),
    } as never);
    const p = await probeAll(deps({ env }));
    expect(p.brain.reach).toEqual({ kind: "failed", reason: "unavailable" });
    expect(p.calendar.reach).toEqual({ kind: "failed", reason: "not_found" });
  });
});
