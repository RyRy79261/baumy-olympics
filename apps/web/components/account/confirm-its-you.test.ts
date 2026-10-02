import { describe, expect, it, vi } from "vitest";

// Confirming it's you with Google (issue #135): the URL Better Auth makes is
// sent with Google asked to take the password again.

vi.mock("./step-up-actions", () => ({}));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

const { reauthUrl } = await import("./confirm-its-you");

describe("reauthUrl", () => {
  it("asks Google to sign in again, keeping Better Auth's state", () => {
    const made =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=c&state=s&prompt=select_account&scope=openid";
    const url = new URL(reauthUrl(made));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("max_age")).toBe("0");
    expect(url.searchParams.get("state")).toBe("s");
    expect(url.searchParams.get("client_id")).toBe("c");
    expect(url.searchParams.getAll("prompt")).toHaveLength(1);
  });
});
