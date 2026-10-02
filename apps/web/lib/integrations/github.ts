import "server-only";

import { z } from "zod";
import { feedbackTracker, type EnvBag } from "@/lib/feedback/config";
import { isTestMode } from "@/lib/test-mode";
import { memoryGithub } from "./github-memory";

// GitHub Issues, where in-app bug reports go (issue #133). The fetch and its
// answers are camp-404 `apps/web/app/feedback/actions.ts`'s; here they sit
// behind an integration like the others (AGENTS.md "Integrations"): the
// in-memory fake under E2E_TEST_MODE=1, GitHub when GITHUB_FEEDBACK_TOKEN is
// set, otherwise `not_configured`. It never throws, every call has a
// timeout, and what is kept of a failure is its HTTP status: GitHub's error
// body can echo the request, which holds the member's report.

export const GITHUB_TIMEOUT_MS = 8000;

export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
}

export type IssueFailureReason =
  /** 401: the token is wrong or expired. */
  | "invalid_token"
  /** 403 or 404: the token cannot reach the repo, or it is gone. */
  | "no_access"
  /** 410: issues are turned off on the repo. */
  | "issues_disabled"
  | "timeout"
  | "unavailable";

export type CreateIssueResult =
  | { ok: true; number: number; url: string }
  | { ok: false; reason: IssueFailureReason; status?: number };

export type GithubIssues =
  | {
      ok: true;
      kind: "github" | "fake";
      /** `owner/name`, for the Settings card. Never the token. */
      repo: string;
      create(issue: NewIssue): Promise<CreateIssueResult>;
    }
  | { ok: false; reason: "no_token" | "bad_repo" };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const CreatedIssue = z.object({
  number: z.number(),
  html_url: z.string().url(),
});

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "baumy-olympics-feedback",
  };
}

function failureFor(status: number): CreateIssueResult {
  if (status === 401) return { ok: false, reason: "invalid_token", status };
  if (status === 403 || status === 404) {
    return { ok: false, reason: "no_access", status };
  }
  if (status === 410) return { ok: false, reason: "issues_disabled", status };
  return { ok: false, reason: "unavailable", status };
}

/** One POST /repos/{owner}/{name}/issues. */
export async function githubCreateIssue(
  config: { token: string; owner: string; name: string },
  issue: NewIssue,
  fetchImpl: FetchLike = fetch,
  timeoutMs = GITHUB_TIMEOUT_MS,
): Promise<CreateIssueResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(
      `https://api.github.com/repos/${config.owner}/${config.name}/issues`,
      {
        method: "POST",
        headers: headers(config.token),
        body: JSON.stringify(issue),
        signal: controller.signal,
      },
    );
  } catch {
    return controller.signal.aborted
      ? { ok: false, reason: "timeout" }
      : { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
  if (res.status !== 201) return failureFor(res.status);
  const parsed = CreatedIssue.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    return { ok: false, reason: "unavailable", status: res.status };
  }
  return { ok: true, number: parsed.data.number, url: parsed.data.html_url };
}

let override: GithubIssues | null = null;

/** Unit tests only: answer with this client until reset with null. */
export function setGithubIssuesForTests(client: GithubIssues | null): void {
  override = client;
}

export function githubIssues(
  env: EnvBag = process.env,
  fetchImpl: FetchLike = fetch,
): GithubIssues {
  if (override) return override;
  if (isTestMode(env)) {
    return {
      ok: true,
      kind: "fake",
      repo: "e2e/fake-tracker",
      create: memoryGithub,
    };
  }
  const tracker = feedbackTracker(env);
  if (!tracker.ok) return tracker;
  return {
    ok: true,
    kind: "github",
    repo: `${tracker.owner}/${tracker.name}`,
    create: (issue) => githubCreateIssue(tracker, issue, fetchImpl),
  };
}
