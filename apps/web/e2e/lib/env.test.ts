import { describe, expect, it } from "vitest";
import { assertLocalBaseUrl, baseUrl, isLocalHost } from "./env";

describe("baseUrl", () => {
  it("defaults to localhost:3000 and drops trailing slashes", () => {
    expect(baseUrl({})).toBe("http://localhost:3000");
    expect(baseUrl({ E2E_BASE_URL: "  " })).toBe("http://localhost:3000");
    expect(baseUrl({ E2E_BASE_URL: "http://127.0.0.1:4000//" })).toBe(
      "http://127.0.0.1:4000",
    );
  });
});

describe("isLocalHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "[::1]",
    "0.0.0.0",
    "web.localhost",
  ])("accepts %s", (host) => expect(isLocalHost(host)).toBe(true));

  it.each([
    "baumy.vercel.app",
    "example.com",
    "localhost.evil.com",
    "10.0.0.2",
  ])("rejects %s", (host) => expect(isLocalHost(host)).toBe(false));
});

describe("assertLocalBaseUrl", () => {
  it("allows the default and loopback URLs", () => {
    expect(() => assertLocalBaseUrl({})).not.toThrow();
    expect(() =>
      assertLocalBaseUrl({ E2E_BASE_URL: "http://[::1]:3000" }),
    ).not.toThrow();
  });

  it("refuses a remote host, preview or production alike", () => {
    expect(() =>
      assertLocalBaseUrl({ E2E_BASE_URL: "https://baumy-git-x.vercel.app" }),
    ).toThrow(/Refusing to run against baumy-git-x\.vercel\.app/);
    expect(() =>
      assertLocalBaseUrl({ E2E_BASE_URL: "https://baumy.example.com" }),
    ).toThrow(/Refusing/);
  });

  it("refuses something that is not a URL", () => {
    expect(() =>
      assertLocalBaseUrl({ E2E_BASE_URL: "localhost:3000/x y" }),
    ).toThrow(/not a URL|Refusing/);
    expect(() => assertLocalBaseUrl({ E2E_BASE_URL: "::nope" })).toThrow(
      /not a URL/,
    );
  });
});
