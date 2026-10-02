// Where bug reports go, decided from an env bag (issue #133, after camp-404
// `apps/web/lib/integration-config.ts`'s `feedbackTracker`). Pure: the
// action passes `process.env`, and the system status page passes the same
// bag, so the two can never disagree. Nothing here returns a secret for
// display; the token only travels to the GitHub client.

export type EnvBag = Readonly<Record<string, string | undefined>>;

export const DEFAULT_FEEDBACK_REPO = "RyRy79261/baumy-olympics";

/**
 * What a member is told when a report has nowhere to go. One copy, read by
 * the action that returns it and by the Settings card that warns about it.
 */
export const FEEDBACK_UNAVAILABLE_MESSAGE: Record<
  "no_token" | "bad_repo",
  string
> = {
  no_token: "Bug reports aren't set up yet. Let a household admin know.",
  bad_repo:
    "Bug reports aren't configured correctly. Let a household admin know.",
};

export type FeedbackTracker =
  | { ok: true; token: string; owner: string; name: string }
  | { ok: false; reason: "no_token" | "bad_repo" };

const REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** The GitHub token and repo reports go to, or why they can't. */
export function feedbackTracker(env: EnvBag): FeedbackTracker {
  const token = env.GITHUB_FEEDBACK_TOKEN?.trim();
  if (!token) return { ok: false, reason: "no_token" };
  const repo = (env.GITHUB_FEEDBACK_REPO?.trim() || DEFAULT_FEEDBACK_REPO)
    .split("/")
    .map((s) => s.trim());
  // Checked as path segments, since they go into the API URL.
  if (repo.length !== 2 || !repo.every((s) => REPO_SEGMENT.test(s))) {
    return { ok: false, reason: "bad_repo" };
  }
  return { ok: true, token, owner: repo[0]!, name: repo[1]! };
}

/** The filing state the reporter and the Settings card show, without the token. */
export type FilingState = "ok" | "no_token" | "bad_repo";

export function filingState(env: EnvBag, testMode: boolean): FilingState {
  if (testMode) return "ok";
  const tracker = feedbackTracker(env);
  return tracker.ok ? "ok" : tracker.reason;
}
