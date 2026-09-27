import { describe, expect, it } from "vitest";
import { safeCallbackUrl, signInUrl } from "./callback-url";

describe("safeCallbackUrl", () => {
  it("keeps a path on this site, query included", () => {
    expect(safeCallbackUrl("/oauth/consent?a=1&b=2")).toBe(
      "/oauth/consent?a=1&b=2",
    );
    expect(safeCallbackUrl("/")).toBe("/");
  });

  it("sends anything that could leave the site home", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "evil",
      "/a\u0000b",
      "/a\\b",
      `/${"a".repeat(4001)}`,
    ]) {
      expect(safeCallbackUrl(bad)).toBe("/");
    }
  });
});

describe("signInUrl", () => {
  it("adds the way back only when there is one", () => {
    expect(signInUrl()).toBe("/auth/sign-in");
    expect(signInUrl("//evil")).toBe("/auth/sign-in");
    expect(signInUrl("/settings?x=1")).toBe(
      "/auth/sign-in?callbackURL=%2Fsettings%3Fx%3D1",
    );
  });
});
