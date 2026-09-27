// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  basicClientCredentials,
  corsJson,
  corsPreflight,
  escapeHtml,
  htmlError,
  htmlRedirect,
  oauthError,
  readBody,
} from "./http";
import { MCP_NOT_CONFIGURED, mcpPublicOrigin, oauthUrls } from "./origin";
import { isAllowedRedirectUri } from "./redirect-uris";
import {
  MCP_SCOPES,
  defaultTicked,
  describeScopes,
  grantedScopes,
  isMcpScope,
  offeredScopes,
} from "./scopes";
import {
  PKCE_PATTERN,
  TOKEN_PREFIX,
  generateOpaqueToken,
  pkceChallenge,
  verifyPkceS256,
} from "./tokens";

// The pure parts of the MCP OAuth server: tokens and PKCE, scopes, the
// redirect allow-list, the issuer, and the HTTP plumbing.

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("tokens", () => {
  it("are prefixed, url-safe and never repeat", () => {
    const a = generateOpaqueToken(TOKEN_PREFIX.ACCESS);
    const b = generateOpaqueToken(TOKEN_PREFIX.ACCESS);
    expect(a).toMatch(/^baumy_at_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(generateOpaqueToken("x", 16)).toMatch(/^x_[A-Za-z0-9_-]{22}$/);
  });
});

describe("PKCE S256", () => {
  it("matches RFC 7636 appendix B", () => {
    expect(pkceChallenge(VERIFIER)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(
      verifyPkceS256(VERIFIER, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"),
    ).toBe(true);
  });

  it("refuses a wrong verifier, a plain challenge and a malformed verifier", () => {
    const challenge = pkceChallenge(VERIFIER);
    expect(verifyPkceS256(`${VERIFIER.slice(0, -1)}x`, challenge)).toBe(false);
    // `plain` would be the verifier itself.
    expect(verifyPkceS256(VERIFIER, VERIFIER)).toBe(false);
    expect(verifyPkceS256("short", pkceChallenge("short"))).toBe(false);
    expect(verifyPkceS256(VERIFIER, challenge.slice(1))).toBe(false);
    expect(PKCE_PATTERN.test("a".repeat(129))).toBe(false);
  });

  it("is base64url(sha256(verifier))", () => {
    const v = "a".repeat(43);
    expect(pkceChallenge(v)).toBe(
      createHash("sha256").update(v).digest("base64url"),
    );
  });
});

describe("scopes", () => {
  it("offers what was asked for and known, or both", () => {
    expect(offeredScopes("baumy:read")).toEqual(["baumy:read"]);
    expect(offeredScopes("baumy:write  baumy:read other")).toEqual([
      "baumy:read",
      "baumy:write",
    ]);
    expect(offeredScopes(undefined)).toEqual([...MCP_SCOPES]);
    expect(offeredScopes("openid profile")).toEqual([...MCP_SCOPES]);
  });

  it("grants only the ticked boxes that were offered", () => {
    expect(
      grantedScopes(["baumy:read", "baumy:write"], ["baumy:read"]),
    ).toEqual(["baumy:read"]);
    expect(
      grantedScopes(["baumy:read"], ["baumy:read", "baumy:write"]),
    ).toEqual(["baumy:read"]);
    expect(grantedScopes(["baumy:read", "baumy:write"], [])).toEqual([]);
  });

  it("ticks reading by default, never writing", () => {
    expect(defaultTicked(["baumy:read", "baumy:write"])).toEqual([
      "baumy:read",
    ]);
    expect(defaultTicked(["baumy:write"])).toEqual([]);
  });

  it("knows its scopes and reads them out", () => {
    expect(isMcpScope("baumy:write")).toBe(true);
    expect(isMcpScope("admin")).toBe(false);
    expect(describeScopes(["baumy:read", "baumy:write"])).toBe(
      "Read and write",
    );
    expect(describeScopes(["baumy:read"])).toBe("Read only");
    expect(describeScopes(["baumy:write"])).toBe("Write only");
    expect(describeScopes([])).toBe("Nothing");
  });
});

describe("isAllowedRedirectUri", () => {
  it("allows Claude and loopback", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://www.claude.ai/cb",
      "https://claude.com/cb",
      "https://console.anthropic.com/cb",
      "http://localhost:6274/oauth/callback",
      "http://127.0.0.1:33418/callback",
      "https://[::1]:8080/cb",
    ]) {
      expect(isAllowedRedirectUri(ok), ok).toBe(true);
    }
  });

  it("refuses everything else", () => {
    for (const bad of [
      "http://claude.ai/cb",
      "https://evilclaude.ai/cb",
      "https://claude.ai.evil.com/cb",
      "https://evil.example/cb",
      "https://claude.ai/cb#frag",
      "https://user:pw@claude.ai/cb",
      "ftp://localhost/cb",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isAllowedRedirectUri(bad), bad).toBe(false);
    }
  });
});

describe("mcpPublicOrigin", () => {
  const req = new Request("http://localhost:3000/.well-known/x");

  it("uses MCP_PUBLIC_URL's origin when set", () => {
    expect(
      mcpPublicOrigin(req, { MCP_PUBLIC_URL: "https://baumy.example/path/" }),
    ).toBe("https://baumy.example");
    expect(
      mcpPublicOrigin(req, { MCP_PUBLIC_URL: "http://localhost:3000" }),
    ).toBe("http://localhost:3000");
  });

  it("fails closed on a bad MCP_PUBLIC_URL, and on Vercel without one", () => {
    expect(mcpPublicOrigin(req, { MCP_PUBLIC_URL: "not a url" })).toBeNull();
    expect(
      mcpPublicOrigin(req, { MCP_PUBLIC_URL: "http://baumy.example" }),
    ).toBeNull();
    expect(
      mcpPublicOrigin(req, { MCP_PUBLIC_URL: "ftp://x.example" }),
    ).toBeNull();
    expect(
      mcpPublicOrigin(req, {
        VERCEL_ENV: "production",
        VERCEL_URL: "baumy-abc123.vercel.app",
      }),
    ).toBeNull();
    expect(MCP_NOT_CONFIGURED).toContain("MCP_PUBLIC_URL");
  });

  it("uses the request's own origin off Vercel, never VERCEL_URL", () => {
    expect(mcpPublicOrigin(req, { VERCEL_URL: "baumy-abc.vercel.app" })).toBe(
      "http://localhost:3000",
    );
  });

  it("builds every endpoint from the issuer", () => {
    expect(oauthUrls("https://b.example")).toEqual({
      issuer: "https://b.example",
      authorizationEndpoint: "https://b.example/api/mcp/oauth/authorize",
      tokenEndpoint: "https://b.example/api/mcp/oauth/token",
      registrationEndpoint: "https://b.example/api/mcp/oauth/register",
      revocationEndpoint: "https://b.example/api/mcp/oauth/revoke",
      resource: "https://b.example/api/mcp",
    });
  });
});

describe("http plumbing", () => {
  it("answers with CORS and no-store", async () => {
    const res = corsJson({ a: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toBe(
      "WWW-Authenticate",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ a: 1 });
    const pre = corsPreflight();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("DELETE");
    const err = oauthError("invalid_grant", "nope", 400);
    expect(await err.json()).toEqual({
      error: "invalid_grant",
      error_description: "nope",
    });
  });

  it("reads form and JSON bodies, and reports a broken one", async () => {
    const form = new Request("http://x", {
      method: "POST",
      body: new URLSearchParams({ a: "1", b: "2" }),
    });
    expect(await readBody(form)).toEqual({
      ok: true,
      fields: { a: "1", b: "2" },
    });
    const json = (body: string) =>
      readBody(
        new Request("http://x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
    expect(await json('{"a":"1","n":2}')).toEqual({
      ok: true,
      fields: { a: "1" },
    });
    expect(await json("")).toEqual({ ok: true, fields: {} });
    expect(await json("{")).toEqual({ ok: false });
    expect(await json("[1]")).toEqual({ ok: false });
    const garbage = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "nope",
    });
    expect(await readBody(garbage)).toEqual({ ok: false });
  });

  it("reads Basic client credentials", () => {
    const basic = (v: string) =>
      basicClientCredentials(
        new Request("http://x", { headers: { authorization: v } }),
      );
    const enc = Buffer.from("id%3A1:s%20ecret").toString("base64");
    expect(basic(`Basic ${enc}`)).toEqual({
      clientId: "id:1",
      clientSecret: "s ecret",
    });
    expect(basic("Bearer x")).toBeNull();
    expect(
      basic(`Basic ${Buffer.from("nocolon").toString("base64")}`),
    ).toBeNull();
    expect(
      basic(`Basic ${Buffer.from("%E0%A4%A:x").toString("base64")}`),
    ).toBeNull();
    expect(basicClientCredentials(new Request("http://x"))).toBeNull();
  });

  it("escapes HTML and navigates with a page, not a 302", async () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
    const target = "https://claude.ai/cb?code=a&state=</script><b>";
    const res = htmlRedirect(target);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain(
      'content="0;url=https://claude.ai/cb?code=a&amp;state=&lt;/script&gt;&lt;b&gt;"',
    );
    expect(body).not.toContain("</script><b>");
    const err = htmlError("Bad <thing>", 403);
    expect(err.status).toBe(403);
    expect(await err.text()).toContain("Bad &lt;thing&gt;");
  });
});
