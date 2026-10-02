import { describe, expect, it } from "vitest";
import {
  deriveSystemStatus,
  type IntegrationCheck,
  type Probes,
  type Reach,
} from "./status";

// The pure half of the system status page (issue #133): each integration as
// configured or not and answering or not, with the reason in words.

const OK: Reach = { kind: "ok", latencyMs: 12 };

function probes(overrides: Partial<Probes> = {}): Probes {
  return {
    database: { configured: true, reach: OK },
    email: { configured: true, reach: { kind: "not_checked" } },
    brain: { configured: true, reach: OK },
    calendar: { configured: true, reach: OK },
    claude: { configured: true, reach: OK },
    groq: { configured: true, reach: OK },
    blob: { configured: true, reach: { kind: "not_checked" } },
    bugReports: {
      configured: true,
      problem: null,
      repo: "RyRy79261/baumy-olympics",
      reach: OK,
    },
    ...overrides,
  };
}

function find(p: Probes, id: string): IntegrationCheck {
  const c = deriveSystemStatus(p).checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

describe("deriveSystemStatus", () => {
  it("lists the seven integrations the issue names, and bug reports", () => {
    expect(deriveSystemStatus(probes()).checks.map((c) => c.label)).toEqual([
      "Database",
      "Email (Resend)",
      "Baumy's brain",
      "Google Calendar",
      "Claude (Anthropic)",
      "Voice (Groq)",
      "Photo storage (Vercel Blob)",
      "Bug reports (GitHub)",
    ]);
  });

  it("is all clear when everything is set up and answering", () => {
    const status = deriveSystemStatus(probes());
    expect(status.headline).toEqual({
      tone: "ok",
      summary:
        "Everything this page checks is set up, and every live check answered.",
    });
    const brain = find(probes(), "brain");
    expect(brain).toMatchObject({
      configured: true,
      reachable: "yes",
      tone: "ok",
      env: ["BRAIN_BASE_URL", "KITCHEN_API_TOKEN"],
    });
    expect(brain.detail).toContain("answered in 12 ms");
    expect(find(probes(), "bugReports").detail).toContain(
      "Reports go to RyRy79261/baumy-olympics.",
    );
  });

  it("says why Resend and Blob are not checked live", () => {
    expect(find(probes(), "email")).toMatchObject({
      configured: true,
      reachable: "not_checked",
      tone: "ok",
    });
    expect(find(probes(), "email").detail).toContain("Not checked live");
    expect(find(probes(), "blob").detail).toContain("billed operation");
  });

  it("names an optional service that is off, without alarm", () => {
    const p = probes({
      groq: { configured: false, reach: { kind: "not_checked" } },
    });
    expect(find(p, "groq")).toMatchObject({
      configured: false,
      reachable: "not_checked",
      tone: "degraded",
    });
    expect(find(p, "groq").detail).toContain("microphone is hidden");
    expect(deriveSystemStatus(p).headline).toMatchObject({
      tone: "degraded",
      summary: "Running without: Voice (Groq). Each says so where it is used.",
    });
  });

  it("raises a missing database, a malformed tracker and a service that stopped answering", () => {
    const p = probes({
      database: { configured: false, reach: { kind: "not_checked" } },
      calendar: {
        configured: true,
        reach: { kind: "failed", reason: "unavailable" },
      },
      claude: {
        configured: true,
        reach: { kind: "failed", reason: "key refused", status: 401 },
      },
      bugReports: {
        configured: false,
        problem: "bad_repo",
        repo: null,
        reach: { kind: "not_checked" },
      },
    });
    expect(find(p, "database").tone).toBe("attention");
    expect(find(p, "calendar")).toMatchObject({
      reachable: "no",
      tone: "attention",
    });
    expect(find(p, "calendar").detail).toContain(
      "It did not answer (unavailable).",
    );
    expect(find(p, "claude").detail).toContain(
      "It answered 401 (key refused).",
    );
    expect(find(p, "bugReports").tone).toBe("attention");
    expect(find(p, "bugReports").detail).toContain("must be owner/name");
    expect(deriveSystemStatus(p).headline.summary).toBe(
      "Needs attention: Database, Google Calendar, Claude (Anthropic), Bug reports (GitHub).",
    );
  });

  it("says when a fake stands in, under test mode", () => {
    const p = probes({ brain: { configured: true, reach: { kind: "fake" } } });
    expect(find(p, "brain")).toMatchObject({ reachable: "fake", tone: "info" });
    expect(find(p, "brain").detail).toContain("in-memory fake");
  });
});
