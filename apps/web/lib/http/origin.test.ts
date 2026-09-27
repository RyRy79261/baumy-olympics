import { describe, expect, it } from "vitest";
import { isSameOriginRequest, rejectCrossSite } from "./origin";

// The CSRF check for cookie-authenticated POST route handlers.

const env = {
  BETTER_AUTH_URL: "https://baumy.example",
} as unknown as NodeJS.ProcessEnv;

function post(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/actions/run", {
    method: "POST",
    headers,
  });
}

describe("isSameOriginRequest", () => {
  it("trusts Sec-Fetch-Site when the browser sends it", () => {
    expect(
      isSameOriginRequest(post({ "sec-fetch-site": "same-origin" }), env),
    ).toBe(true);
    for (const site of ["cross-site", "same-site", "none"]) {
      // Even with a matching Origin: the browser's verdict wins.
      expect(
        isSameOriginRequest(
          post({
            "sec-fetch-site": site,
            origin: "http://localhost:3000",
            host: "localhost:3000",
          }),
          env,
        ),
      ).toBe(false);
    }
  });

  it("otherwise needs an Origin naming this host or a trusted origin", () => {
    expect(
      isSameOriginRequest(
        post({ origin: "http://localhost:3000", host: "localhost:3000" }),
        env,
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        post({
          origin: "https://app.example",
          "x-forwarded-host": "app.example",
          host: "internal",
        }),
        env,
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        post({ origin: "https://baumy.example", host: "x" }),
        env,
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        post({ origin: "https://evil.example", host: "localhost:3000" }),
        env,
      ),
    ).toBe(false);
  });

  it("refuses a POST with neither header, a null origin or a garbage one", () => {
    expect(isSameOriginRequest(post({}), env)).toBe(false);
    expect(
      isSameOriginRequest(
        post({ origin: "null", host: "localhost:3000" }),
        env,
      ),
    ).toBe(false);
    expect(
      isSameOriginRequest(
        post({ origin: "not a url", host: "localhost:3000" }),
        env,
      ),
    ).toBe(false);
  });

  it("reads process.env by default", () => {
    expect(isSameOriginRequest(post({ "sec-fetch-site": "same-origin" }))).toBe(
      true,
    );
  });
});

describe("rejectCrossSite", () => {
  it("returns null for a same-origin request and a 403 otherwise", async () => {
    expect(
      rejectCrossSite(post({ "sec-fetch-site": "same-origin" }), env),
    ).toBeNull();
    const res = rejectCrossSite(post({ "sec-fetch-site": "cross-site" }));
    expect(res?.status).toBe(403);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    await expect(res?.json()).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});
