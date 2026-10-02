// What this deployment is set up with, and whether each service answers
// (issue #133). Shown to admins on /settings/system. After camp-404
// `apps/web/lib/system-status.ts`, cut to the integrations Baumy has.
//
// Three rules, camp-404's:
//
//  1. Never print a secret. A check says whether a setting is SET and what
//     follows from that, and names the env vars that decide it: names only,
//     never a value. A live check keeps an HTTP status and a reason word,
//     never a provider's text; status.test.ts seeds every setting with a
//     marker and proves no marker reaches any string.
//  2. Derive, do not duplicate. "Configured" comes from the same function the
//     integration itself uses (brainConfig, calendarConfig, feedbackTracker,
//     isEmailProviderConfigured), so the page cannot disagree with the app.
//  3. Say why. "Not set: the shopping list says it is not connected" ends
//     the search; "Off" alone starts one.
//
// Pure: no `server-only`, no `process.env`, no network. lib/system/probe.ts
// is the server half that reads the real env and runs the live checks.

/** A live check's answer. */
export type Reach =
  /** It answered, in this many ms. */
  | { kind: "ok"; latencyMs: number }
  /** It did not answer, or refused. `status` is the HTTP status, if any. */
  | { kind: "failed"; reason: string; status?: number }
  /** Not tried: there is no cheap, safe way, or it is not set up. */
  | { kind: "not_checked" }
  /** E2E test mode: the in-memory fake stands in for it. */
  | { kind: "fake" };

export type CheckTone = "ok" | "degraded" | "attention" | "info";

export interface IntegrationCheck {
  id: string;
  label: string;
  configured: boolean;
  /** "yes", "no", "not checked" or "test fake", for the badge. */
  reachable: "yes" | "no" | "not_checked" | "fake";
  tone: CheckTone;
  /** Why it is in that state, and what follows. Never a secret. */
  detail: string;
  /** The env var NAMES that decide it. */
  env: readonly string[];
}

export interface SystemStatus {
  checks: IntegrationCheck[];
  /** The worst thing on the page, named. */
  headline: { tone: CheckTone; summary: string };
}

/** What probe.ts found, per integration. */
export interface Probes {
  database: { configured: boolean; reach: Reach };
  email: { configured: boolean; reach: Reach };
  brain: { configured: boolean; reach: Reach };
  calendar: { configured: boolean; reach: Reach };
  claude: { configured: boolean; reach: Reach };
  groq: { configured: boolean; reach: Reach };
  blob: { configured: boolean; reach: Reach };
  bugReports: {
    configured: boolean;
    /** Why reports cannot be filed, when they cannot. */
    problem: "no_token" | "bad_repo" | null;
    /** `owner/name`. Not a secret: it is the public tracker. */
    repo: string | null;
    reach: Reach;
  };
}

interface Spec {
  id: keyof Probes;
  label: string;
  env: readonly string[];
  /** A service the household cannot do without. */
  core?: boolean;
  /** What works, once it is set up and answering. */
  on: string;
  /** What happens without it. */
  off: string;
  /** Why it is not checked live, when it never is. */
  notChecked?: string;
}

const SPECS: readonly Spec[] = [
  {
    id: "database",
    label: "Database",
    env: ["DATABASE_URL", "DATABASE_URL_UNPOOLED"],
    core: true,
    on: "One test query answered.",
    off: "Every page that reads data fails until DATABASE_URL is set.",
  },
  {
    id: "email",
    label: "Email (Resend)",
    env: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
    on: "Sign-in links and password resets go out through Resend.",
    off: "No email goes out: a forgotten password cannot be reset by email. Resend needs both the key and a from-address.",
    notChecked:
      "Not checked live: Resend has no free check a send-only key may call, and sending a test email would land in someone's inbox.",
  },
  {
    id: "brain",
    label: "Baumy's brain",
    env: ["BRAIN_BASE_URL", "KITCHEN_API_TOKEN"],
    on: "The shopping list is brain's, and Sign in with Baumy can DM its button.",
    off: "The shopping list says it is not connected. BRAIN_BASE_URL must be https (http only for localhost).",
  },
  {
    id: "calendar",
    label: "Google Calendar",
    env: [
      "GOOGLE_CALENDAR_ID",
      "GOOGLE_CALENDAR_CLIENT_EMAIL",
      "GOOGLE_CALENDAR_PRIVATE_KEY",
    ],
    on: "The calendar reads and writes the shared Google Calendar.",
    off: "The calendar says it is not connected. All three settings are needed, and the calendar must be shared with the service account.",
  },
  {
    id: "claude",
    label: "Claude (Anthropic)",
    env: ["ANTHROPIC_API_KEY"],
    on: "Ask Baumy answers, and Improve with AI tidies bug reports.",
    off: "Ask Baumy says it is not connected yet; bug reports are filed as written.",
  },
  {
    id: "groq",
    label: "Voice (Groq)",
    env: ["GROQ_API_KEY"],
    on: "The microphone in Ask Baumy writes out what was said.",
    off: "The microphone is hidden; typing still works.",
  },
  {
    id: "blob",
    label: "Photo storage (Vercel Blob)",
    env: ["BLOB_READ_WRITE_TOKEN"],
    on: "Proof photos and avatar images are stored in the private Blob store.",
    off: "Photo and avatar uploads say they are not set up, and nothing is saved.",
    notChecked:
      "Not checked live: every Blob call is a billed operation, so the page does not spend one.",
  },
  {
    id: "bugReports",
    label: "Bug reports (GitHub)",
    env: ["GITHUB_FEEDBACK_TOKEN", "GITHUB_FEEDBACK_REPO"],
    on: "A shake, or Settings' card, files a GitHub issue.",
    off: "The reporter still opens, and says reports aren't set up yet.",
  },
];

function reachable(reach: Reach): IntegrationCheck["reachable"] {
  switch (reach.kind) {
    case "ok":
      return "yes";
    case "failed":
      return "no";
    case "fake":
      return "fake";
    case "not_checked":
      return "not_checked";
  }
}

function failure(reach: Extract<Reach, { kind: "failed" }>): string {
  return reach.status
    ? `It answered ${reach.status} (${reach.reason}).`
    : `It did not answer (${reach.reason}).`;
}

function check(spec: Spec, probes: Probes): IntegrationCheck {
  const probe = probes[spec.id];
  const base = {
    id: spec.id,
    label: spec.label,
    env: spec.env,
    configured: probe.configured,
    reachable: reachable(probe.reach),
  };
  const bugs = spec.id === "bugReports" ? probes.bugReports : null;

  if (!probe.configured) {
    const why =
      bugs?.problem === "bad_repo"
        ? "GITHUB_FEEDBACK_REPO must be owner/name; every report fails until it is fixed."
        : spec.off;
    return {
      ...base,
      reachable: "not_checked",
      tone: spec.core || bugs?.problem === "bad_repo" ? "attention" : "degraded",
      detail: `Not set up. ${why}`,
    };
  }
  const where = bugs?.repo ? ` Reports go to ${bugs.repo}.` : "";
  switch (probe.reach.kind) {
    case "ok":
      return {
        ...base,
        tone: "ok",
        detail: `Set up, and answered in ${probe.reach.latencyMs} ms. ${spec.on}${where}`,
      };
    case "failed":
      return {
        ...base,
        tone: "attention",
        detail: `Set up, but not answering. ${failure(probe.reach)} ${spec.off}`,
      };
    case "fake":
      return {
        ...base,
        tone: "info",
        detail: `Test mode: the in-memory fake stands in for it. ${spec.on}`,
      };
    case "not_checked":
      return {
        ...base,
        tone: "ok",
        detail: `Set up. ${spec.notChecked ?? "Not checked live."} ${spec.on}${where}`,
      };
  }
}

function worst(checks: readonly IntegrationCheck[]): CheckTone {
  if (checks.some((c) => c.tone === "attention")) return "attention";
  if (checks.some((c) => c.tone === "degraded")) return "degraded";
  return "ok";
}

/** The whole report. Pure: the same probes give the same report. */
export function deriveSystemStatus(probes: Probes): SystemStatus {
  const checks = SPECS.map((spec) => check(spec, probes));
  const tone = worst(checks);
  const named = (t: CheckTone) =>
    checks
      .filter((c) => c.tone === t)
      .map((c) => c.label)
      .join(", ");
  const summary =
    tone === "attention"
      ? `Needs attention: ${named("attention")}.`
      : tone === "degraded"
        ? `Running without: ${named("degraded")}. Each says so where it is used.`
        : "Everything this page checks is set up, and every live check answered.";
  return { checks, headline: { tone, summary } };
}
