// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  githubCreateIssue,
  githubIssues,
  setGithubIssuesForTests,
} from "./github";
import { clearMemoryIssues, memoryIssues } from "./github-memory";

// The GitHub Issues client (issue #133): which one this environment gets, the
// request it makes, and each answer as a result, never a throw. A failure
// keeps the HTTP status only.

const CONFIG = { token: "ghp_test", owner: "me", name: "repo" };
const ISSUE = { title: "T", body: "B", labels: ["bug"] };

afterEach(() => {
  setGithubIssuesForTests(null);
  clearMemoryIssues();
});

describe("githubCreateIssue", () => {
  it("POSTs the issue with the token and reads the number and link", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            number: 7,
            html_url: "https://github.com/me/repo/issues/7",
          }),
          { status: 201 },
        ),
    );
    await expect(githubCreateIssue(CONFIG, ISSUE, fetchImpl)).resolves.toEqual({
      ok: true,
      number: 7,
      url: "https://github.com/me/repo/issues/7",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.github.com/repos/me/repo/issues");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ghp_test",
    );
    expect(JSON.parse(init.body as string)).toEqual(ISSUE);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps each status to a reason", async () => {
    const answer = (status: number) =>
      githubCreateIssue(
        CONFIG,
        ISSUE,
        async () => new Response("{}", { status }),
      );
    await expect(answer(401)).resolves.toEqual({
      ok: false,
      reason: "invalid_token",
      status: 401,
    });
    await expect(answer(403)).resolves.toMatchObject({ reason: "no_access" });
    await expect(answer(404)).resolves.toMatchObject({ reason: "no_access" });
    await expect(answer(410)).resolves.toMatchObject({
      reason: "issues_disabled",
    });
    await expect(answer(502)).resolves.toMatchObject({
      reason: "unavailable",
      status: 502,
    });
    // A 201 GitHub answered in a shape we don't know.
    await expect(answer(201)).resolves.toMatchObject({
      ok: false,
      reason: "unavailable",
      status: 201,
    });
  });

  it("is a timeout when GitHub does not answer in time, and unavailable when the network fails", async () => {
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    await expect(githubCreateIssue(CONFIG, ISSUE, hanging, 5)).resolves.toEqual(
      { ok: false, reason: "timeout" },
    );
    await expect(
      githubCreateIssue(CONFIG, ISSUE, async () => {
        throw new Error("ECONNRESET");
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("githubIssues", () => {
  it("is not configured without a token, or with a malformed repo", () => {
    expect(githubIssues({})).toEqual({ ok: false, reason: "no_token" });
    expect(
      githubIssues({ GITHUB_FEEDBACK_TOKEN: "t", GITHUB_FEEDBACK_REPO: "x" }),
    ).toEqual({ ok: false, reason: "bad_repo" });
  });

  it("talks to GitHub with the token, and names the repo but never the token", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    const client = githubIssues(
      { GITHUB_FEEDBACK_TOKEN: "ghp_secret", GITHUB_FEEDBACK_REPO: "a/b" },
      fetchImpl,
    );
    expect(client).toMatchObject({ ok: true, kind: "github", repo: "a/b" });
    expect(JSON.stringify(client)).not.toContain("ghp_secret");
    if (!client.ok) throw new Error("expected a client");
    await client.create(ISSUE);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("is the in-memory fake in test mode, numbering from 1", async () => {
    const client = githubIssues({ E2E_TEST_MODE: "1" });
    expect(client).toMatchObject({ ok: true, kind: "fake" });
    if (!client.ok) throw new Error("expected a client");
    await expect(client.create(ISSUE)).resolves.toMatchObject({
      ok: true,
      number: 1,
    });
    await expect(client.create(ISSUE)).resolves.toMatchObject({ number: 2 });
    expect(memoryIssues().map((i) => i.number)).toEqual([1, 2]);
  });

  it("answers with the test override", () => {
    setGithubIssuesForTests({ ok: false, reason: "bad_repo" });
    expect(githubIssues({ GITHUB_FEEDBACK_TOKEN: "t" })).toEqual({
      ok: false,
      reason: "bad_repo",
    });
  });
});
