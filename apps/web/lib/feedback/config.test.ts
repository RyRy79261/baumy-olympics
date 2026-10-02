import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDBACK_REPO, feedbackTracker, filingState } from "./config";

describe("feedbackTracker", () => {
  it("needs a token, and defaults to this repository", () => {
    expect(feedbackTracker({})).toEqual({ ok: false, reason: "no_token" });
    expect(feedbackTracker({ GITHUB_FEEDBACK_TOKEN: "  " })).toEqual({
      ok: false,
      reason: "no_token",
    });
    const [owner, name] = DEFAULT_FEEDBACK_REPO.split("/");
    expect(feedbackTracker({ GITHUB_FEEDBACK_TOKEN: "t0ken" })).toEqual({
      ok: true,
      token: "t0ken",
      owner,
      name,
    });
  });

  it("takes owner/name, and refuses anything else", () => {
    expect(
      feedbackTracker({
        GITHUB_FEEDBACK_TOKEN: "t",
        GITHUB_FEEDBACK_REPO: " me/my-repo.x ",
      }),
    ).toMatchObject({ ok: true, owner: "me", name: "my-repo.x" });
    for (const repo of ["just-a-name", "a/b/c", "a/", "a/b?x=1", "a/../b"]) {
      expect(
        feedbackTracker({
          GITHUB_FEEDBACK_TOKEN: "t",
          GITHUB_FEEDBACK_REPO: repo,
        }),
      ).toEqual({ ok: false, reason: "bad_repo" });
    }
  });
});

describe("filingState", () => {
  it("is ok in test mode, else the tracker's reason", () => {
    expect(filingState({}, true)).toBe("ok");
    expect(filingState({}, false)).toBe("no_token");
    expect(
      filingState(
        { GITHUB_FEEDBACK_TOKEN: "t", GITHUB_FEEDBACK_REPO: "nope" },
        false,
      ),
    ).toBe("bad_repo");
    expect(filingState({ GITHUB_FEEDBACK_TOKEN: "t" }, false)).toBe("ok");
  });
});
