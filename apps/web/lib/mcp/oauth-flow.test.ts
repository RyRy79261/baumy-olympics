// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction, type Queryable } from "@baumy/db";
import {
  MCP_ACCESS_TOKEN_TTL_MS,
  MCP_AUTH_CODE_TTL_MS,
} from "@baumy/db/mcp-oauth";
import {
  auditEvents,
  mcpAccessTokens,
  mcpAuthCodes,
  members,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  accountActor,
  allowAll,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { runAction } from "@/lib/actions/registry";
import { fail } from "@/lib/actions/result";
import type { Actor } from "@/lib/auth";
import { now } from "@/lib/clock";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import {
  CONSENT_PATH,
  MCP_RATE_LIMITS,
  handleAuthServerMetadata,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleProtectedResourceMetadata,
  handleRegister,
  handleRevoke,
  handleToken,
  type McpRouteDeps,
} from "./routes";
import { pkceChallenge } from "./tokens";
import { mcpActor, verifyToken } from "./verify";

// The MCP OAuth server end to end on PGlite, through the route handlers and
// the real registry: a scripted client registers, is sent to consent, a
// member approves the boxes they ticked, and the client exchanges the code
// (PKCE S256), refreshes (rotation) and revokes. Plus every way it refuses.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const ORIGIN = "http://localhost:3000";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(20) + "-verifier-for-the-pkce-check-123";
const STATE = "state-xyz";

let actor: Actor | null;
let deps: McpRouteDeps;

beforeEach(() => {
  __resetMemoryRateLimits();
  actor = null;
  deps = {
    env: {},
    db,
    withTransaction,
    rateLimiter: allowAll,
    requestCtx: async (requestId) =>
      actor ? ctxFor(actor, { requestId, now: now() }) : null,
    runAction: (name, input, ctx) => runAction(name, input, ctx),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

function json(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function form(
  path: string,
  fields: Record<string, string | string[]>,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
  }
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body });
}

async function register(
  extra: Record<string, unknown> = {},
): Promise<{ client_id: string; client_secret?: string }> {
  const res = await handleRegister(
    json("/api/mcp/oauth/register", {
      client_name: "Claude",
      redirect_uris: [REDIRECT],
      ...extra,
    }),
    deps,
  );
  expect(res.status).toBe(201);
  return res.json();
}

function authorizeParams(clientId: string, over: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: pkceChallenge(VERIFIER),
    code_challenge_method: "S256",
    state: STATE,
    scope: "baumy:read baumy:write",
    ...over,
  };
}

let approvals = 0;
/** The consent form, approved with `scopes` ticked. */
async function approve(
  clientId: string,
  scopes: string[],
  over: Record<string, string> = {},
) {
  approvals += 1;
  return handleAuthorizePost(
    form("/api/mcp/oauth/authorize", {
      ...authorizeParams(clientId),
      decision: "approve",
      grant: scopes,
      requestId: `approve-${approvals}-${Date.now()}`,
      ...over,
    }),
    deps,
  );
}

/** The `code` a page-redirect sends back to the client. */
async function codeFrom(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  const html = await res.text();
  const m = /window\.location\.replace\("([^"]+)"\)/.exec(html);
  const url = new URL(JSON.parse(`"${m![1]}"`) as string);
  expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
  expect(url.searchParams.get("state")).toBe(STATE);
  return url.searchParams.get("code")!;
}

async function exchange(
  clientId: string,
  code: string,
  over: Record<string, string> = {},
) {
  return handleToken(
    form(
      "/api/mcp/oauth/token",
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: VERIFIER,
        ...over,
      },
      {},
    ),
    deps,
  );
}

async function refresh(clientId: string, refreshToken: string) {
  return handleToken(
    form(
      "/api/mcp/oauth/token",
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      },
      {},
    ),
    deps,
  );
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

/** A member connects a fresh client with `scopes` ticked. */
async function connect(memberId: string, scopes: string[]) {
  actor = sessionActor(memberId);
  const { client_id } = await register();
  const code = await codeFrom(await approve(client_id, scopes));
  const res = await exchange(client_id, code);
  expect(res.status).toBe(200);
  return { clientId: client_id, tokens: (await res.json()) as Tokens };
}

describe("the full round trip", () => {
  it("registers, consents, exchanges, refreshes with rotation and revokes", async () => {
    const ryan = await seedMember(db(), { displayName: "Ryan" });
    actor = sessionActor(ryan);

    const { client_id } = await register();
    expect(client_id).toMatch(/^baumy_client_/);

    // GET authorize → the consent page, the request carried along.
    const get = await handleAuthorizeGet(
      new Request(
        `${ORIGIN}/api/mcp/oauth/authorize?${new URLSearchParams(authorizeParams(client_id))}`,
      ),
      deps,
    );
    expect(get.status).toBe(302);
    const loc = get.headers.get("location")!;
    expect(loc.startsWith(`${CONSENT_PATH}?`)).toBe(true);
    expect(new URLSearchParams(loc.split("?")[1]).get("client_id")).toBe(
      client_id,
    );

    const code = await codeFrom(
      await approve(client_id, ["baumy:read", "baumy:write"]),
    );
    expect(code).toMatch(/^baumy_ac_/);
    // Only the hash is stored, and the audit row never holds the code.
    const codes = await t.db().select().from(mcpAuthCodes);
    expect(JSON.stringify(codes)).not.toContain(code);
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "authorize_mcp_client"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toEqual({
      clientName: "Claude",
      scopes: ["baumy:read", "baumy:write"],
    });
    expect(JSON.stringify(audits)).not.toContain(code);

    const res = await exchange(client_id, code);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const first = (await res.json()) as Tokens;
    expect(first).toMatchObject({
      token_type: "Bearer",
      expires_in: MCP_ACCESS_TOKEN_TTL_MS / 1000,
      scope: "baumy:read baumy:write",
    });
    expect(await verifyToken(first.access_token, db())).toEqual({
      memberId: ryan,
      scopes: ["baumy:read", "baumy:write"],
      clientId: client_id,
    });
    // The code works once.
    expect((await exchange(client_id, code)).status).toBe(400);

    // Refresh: a new pair, the old one dead, the grant kept.
    const r = await refresh(client_id, first.refresh_token);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const second = (await r.json()) as Tokens;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.scope).toBe("baumy:read baumy:write");
    expect(await verifyToken(first.access_token, db())).toBeNull();
    expect(await verifyToken(second.access_token, db())).not.toBeNull();
    const reuse = await refresh(client_id, first.refresh_token);
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toMatchObject({ error: "invalid_grant" });
    const grants = new Set(
      (await t.db().select().from(mcpAccessTokens)).map((r) => r.grantId),
    );
    expect(grants.size).toBe(1);

    // Revoke by refresh token kills the pair; the answer is 200 either way.
    const rev = await handleRevoke(
      form(
        "/api/mcp/oauth/revoke",
        { token: second.refresh_token, client_id },
        {},
      ),
      deps,
    );
    expect(rev.status).toBe(200);
    expect(await verifyToken(second.access_token, db())).toBeNull();
    const again = await handleRevoke(
      form("/api/mcp/oauth/revoke", { token: "unknown", client_id }, {}),
      deps,
    );
    expect(again.status).toBe(200);
  });
});

describe("the member gate", () => {
  it("gives a signed-in account with no member row no code", async () => {
    await seedMember(db());
    const { client_id } = await register();
    actor = accountActor("user_without_member");
    const res = await approve(client_id, ["baumy:read"]);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Only household members");
    expect(await t.db().select().from(mcpAuthCodes)).toEqual([]);
  });

  it("asks someone whose session ended to sign in again", async () => {
    const { client_id } = await register();
    actor = null;
    const res = await approve(client_id, ["baumy:read"]);
    expect(res.status).toBe(401);
    expect(await t.db().select().from(mcpAuthCodes)).toEqual([]);
  });

  it("stops a deactivated member's code, refresh token and access token", async () => {
    const sam = await seedMember(db());
    const { clientId, tokens } = await connect(sam, ["baumy:read"]);
    const code = await codeFrom(await approve(clientId, ["baumy:read"]));
    expect(await verifyToken(tokens.access_token, db())).not.toBeNull();

    await t
      .db()
      .update(members)
      .set({ deactivatedAt: now() })
      .where(eq(members.id, sam));
    expect(await verifyToken(tokens.access_token, db())).toBeNull();
    expect((await refresh(clientId, tokens.refresh_token)).status).toBe(400);
    expect((await exchange(clientId, code)).status).toBe(400);
  });
});

describe("scope granting", () => {
  it("unticking baumy:write yields a read-only token that cannot write", async () => {
    const ryan = await seedMember(db());
    const { tokens } = await connect(ryan, ["baumy:read"]);
    expect(tokens.scope).toBe("baumy:read");
    const info = (await verifyToken(tokens.access_token, db()))!;
    expect(info.scopes).toEqual(["baumy:read"]);

    const ctx = ctxFor(mcpActor(info), { source: "mcp", now: now() });
    const read = await runAction("whoami", {}, ctx);
    expect(read.ok).toBe(true);
    const write = await runAction("create_note", { title: "Hi" }, ctx);
    expect(write).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(!write.ok && write.message).toContain("baumy:write");
  });

  it("never grants a scope that was not offered, and needs at least one", async () => {
    const ryan = await seedMember(db());
    actor = sessionActor(ryan);
    const { client_id } = await register();
    // Asked for read only; ticking write too grants read only.
    const code = await codeFrom(
      await approve(client_id, ["baumy:read", "baumy:write"], {
        scope: "baumy:read",
      }),
    );
    const tokens = (await (await exchange(client_id, code)).json()) as Tokens;
    expect(tokens.scope).toBe("baumy:read");

    const none = await approve(client_id, []);
    expect(none.status).toBe(303);
    expect(none.headers.get("location")).toMatch(
      /^\/oauth\/consent\?.*&consent_error=no_scope$/,
    );
    const unknown = await approve(client_id, ["admin"]);
    expect(unknown.status).toBe(303);
  });

  it("sends a denial back to the client as access_denied", async () => {
    const { client_id } = await register();
    const res = await handleAuthorizePost(
      form("/api/mcp/oauth/authorize", {
        ...authorizeParams(client_id),
        decision: "deny",
      }),
      deps,
    );
    const html = await res.text();
    expect(html).toContain("error=access_denied");
    expect(html).toContain(`state=${STATE}`);
    expect(html).not.toContain("code=");
  });
});

describe("the token endpoint refuses", () => {
  it("a wrong PKCE verifier, and then the code is spent", async () => {
    const ryan = await seedMember(db());
    actor = sessionActor(ryan);
    const { client_id } = await register();
    const code = await codeFrom(await approve(client_id, ["baumy:read"]));
    const bad = await exchange(client_id, code, {
      code_verifier: "w".repeat(43),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_grant" });
    expect((await exchange(client_id, code)).status).toBe(400);
  });

  it("another client's code, without spending it", async () => {
    const ryan = await seedMember(db());
    actor = sessionActor(ryan);
    const a = await register();
    const b = await register();
    const code = await codeFrom(await approve(a.client_id, ["baumy:read"]));
    expect((await exchange(b.client_id, code)).status).toBe(400);
    expect(
      (
        await exchange(a.client_id, code, {
          redirect_uri: "https://claude.ai/x",
        })
      ).status,
    ).toBe(400);
    expect((await exchange(a.client_id, code)).status).toBe(200);
  });

  it("an expired code", async () => {
    const ryan = await seedMember(db());
    actor = sessionActor(ryan);
    const { client_id } = await register();
    const code = await codeFrom(await approve(client_id, ["baumy:read"]));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + MCP_AUTH_CODE_TTL_MS + 1000);
    expect((await exchange(client_id, code)).status).toBe(400);
  });

  it("bad requests, unknown clients and unknown grants", async () => {
    const { client_id } = await register();
    const post = (fields: Record<string, string>) =>
      handleToken(form("/api/mcp/oauth/token", fields, {}), deps);

    const unsupported = await post({ grant_type: "password", client_id });
    expect(await unsupported.json()).toMatchObject({
      error: "unsupported_grant_type",
    });
    const noClient = await post({
      grant_type: "refresh_token",
      client_id: "nope",
      refresh_token: "x",
    });
    expect(noClient.status).toBe(401);
    expect(await noClient.json()).toMatchObject({ error: "invalid_client" });
    expect(
      (await post({ grant_type: "refresh_token", refresh_token: "x" })).status,
    ).toBe(401);
    const missing = await post({ grant_type: "authorization_code", client_id });
    expect(await missing.json()).toMatchObject({ error: "invalid_request" });
    const noRefresh = await post({ grant_type: "refresh_token", client_id });
    expect(await noRefresh.json()).toMatchObject({ error: "invalid_request" });
    const unknownRefresh = await post({
      grant_type: "refresh_token",
      client_id,
      refresh_token: "nope",
    });
    expect(await unknownRefresh.json()).toMatchObject({
      error: "invalid_grant",
    });

    const broken = await handleToken(
      json("/api/mcp/oauth/token", "{not json"),
      deps,
    );
    expect(broken.status).toBe(400);
    expect(broken.headers.get("cache-control")).toBe("no-store");
  });

  it("a confidential client without its secret; Basic or body both work", async () => {
    const ryan = await seedMember(db());
    actor = sessionActor(ryan);
    const { client_id, client_secret } = await register({
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect(client_secret).toMatch(/^baumy_secret_/);
    const code = await codeFrom(await approve(client_id, ["baumy:read"]));
    const wrong = await exchange(client_id, code, { client_secret: "nope" });
    expect(wrong.status).toBe(401);
    const noSecret = await exchange(client_id, code);
    expect(noSecret.status).toBe(401);

    const basic = Buffer.from(
      `${encodeURIComponent(client_id)}:${encodeURIComponent(client_secret!)}`,
    ).toString("base64");
    const res = await handleToken(
      form(
        "/api/mcp/oauth/token",
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT,
          code_verifier: VERIFIER,
        },
        { authorization: `Basic ${basic}` },
      ),
      deps,
    );
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as Tokens;
    const rev = await handleRevoke(
      form(
        "/api/mcp/oauth/revoke",
        {
          token: tokens.access_token,
          client_id,
          client_secret: client_secret!,
        },
        {},
      ),
      deps,
    );
    expect(rev.status).toBe(200);
    expect(await verifyToken(tokens.access_token, db())).toBeNull();
  });
});

describe("the revoke endpoint refuses", () => {
  it("an unknown client, a missing token and a broken body", async () => {
    const { client_id } = await register();
    const bad = await handleRevoke(
      form("/api/mcp/oauth/revoke", { token: "x", client_id: "nope" }, {}),
      deps,
    );
    expect(bad.status).toBe(401);
    const missing = await handleRevoke(
      form("/api/mcp/oauth/revoke", { client_id }, {}),
      deps,
    );
    expect(await missing.json()).toMatchObject({ error: "invalid_request" });
    const broken = await handleRevoke(json("/api/mcp/oauth/revoke", "{"), deps);
    expect(broken.status).toBe(400);
  });

  it("another client's token, silently", async () => {
    const ryan = await seedMember(db());
    const { tokens } = await connect(ryan, ["baumy:read"]);
    const other = await register();
    const rev = await handleRevoke(
      form(
        "/api/mcp/oauth/revoke",
        { token: tokens.access_token, client_id: other.client_id },
        {},
      ),
      deps,
    );
    expect(rev.status).toBe(200);
    expect(await verifyToken(tokens.access_token, db())).not.toBeNull();
  });
});

describe("registration", () => {
  it("refuses a redirect URI off the allow-list, bad metadata and a non-JSON body", async () => {
    const off = await handleRegister(
      json("/api/mcp/oauth/register", {
        redirect_uris: ["https://evil.example/cb"],
      }),
      deps,
    );
    expect(off.status).toBe(400);
    expect(await off.json()).toMatchObject({ error: "invalid_redirect_uri" });
    const bad = await handleRegister(
      json("/api/mcp/oauth/register", { redirect_uris: [] }),
      deps,
    );
    expect(await bad.json()).toMatchObject({
      error: "invalid_client_metadata",
    });
    const noJson = await handleRegister(
      json("/api/mcp/oauth/register", "nope"),
      deps,
    );
    expect(await noJson.json()).toMatchObject({
      error: "invalid_client_metadata",
    });
  });

  it("is rate limited per address", async () => {
    const seen: string[] = [];
    deps.rateLimiter = {
      limit: async (key, opts) => {
        seen.push(key);
        expect(Object.values(MCP_RATE_LIMITS)).toContainEqual(opts);
        return { ok: false, retryAfterSeconds: 30 };
      },
    };
    const res = await handleRegister(
      json(
        "/api/mcp/oauth/register",
        { redirect_uris: [REDIRECT] },
        { "x-forwarded-for": "203.0.113.9" },
      ),
      deps,
    );
    expect(res.status).toBe(429);
    expect(seen).toEqual(["mcp:register:ip:203.0.113.9"]);
    expect((await handleToken(form("/x", {}, {}), deps)).status).toBe(429);
    expect((await handleRevoke(form("/x", {}, {}), deps)).status).toBe(429);
  });
});

describe("the authorize endpoint refuses", () => {
  it("a malformed request, an unknown client and an unregistered redirect", async () => {
    const { client_id } = await register();
    const get = (params: Record<string, string>) =>
      handleAuthorizeGet(
        new Request(
          `${ORIGIN}/api/mcp/oauth/authorize?${new URLSearchParams(params)}`,
        ),
        deps,
      );
    const plain = await get(
      authorizeParams(client_id, { code_challenge_method: "plain" }),
    );
    expect(plain.status).toBe(400);
    expect(await plain.text()).toContain("S256");
    const unknown = await get(authorizeParams("nope"));
    expect(await unknown.text()).toContain("not registered");
    const elsewhere = await get(
      authorizeParams(client_id, { redirect_uri: "https://claude.ai/other" }),
    );
    expect(elsewhere.status).toBe(400);
    expect(await elsewhere.text()).toContain("did not register");
    // Never redirected to the unregistered address.
    expect(elsewhere.headers.get("location")).toBeNull();

    const post = await handleAuthorizePost(
      form("/api/mcp/oauth/authorize", {
        ...authorizeParams("nope"),
        decision: "approve",
      }),
      deps,
    );
    expect(post.status).toBe(400);
  });

  it("a cross-site form and an unreadable one", async () => {
    const { client_id } = await register();
    const cross = await handleAuthorizePost(
      form(
        "/api/mcp/oauth/authorize",
        {
          ...authorizeParams(client_id),
          decision: "approve",
          grant: "baumy:read",
        },
        { "sec-fetch-site": "cross-site" },
      ),
      deps,
    );
    expect(cross.status).toBe(403);
    const broken = await handleAuthorizePost(
      new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
        method: "POST",
        headers: {
          "sec-fetch-site": "same-origin",
          "content-type": "multipart/form-data; boundary=x",
        },
        body: "nope",
      }),
      deps,
    );
    expect(broken.status).toBe(400);
  });

  it("a replayed approval, and reports the action's own failures", async () => {
    const ryan = await seedMember(db());
    actor = sessionActor(ryan);
    const { client_id } = await register();
    const first = await approve(client_id, ["baumy:read"], {
      requestId: "same-request-1",
    });
    await codeFrom(first);
    const replay = await approve(client_id, ["baumy:read"], {
      requestId: "same-request-1",
    });
    expect(replay.status).toBe(409);

    for (const [code, status] of [
      ["RATE_LIMITED", 429],
      ["SURFACE_FORBIDDEN", 403],
      ["NOT_FOUND", 400],
    ] as const) {
      deps.runAction = async () => fail(code, `said ${code}`);
      const res = await approve(client_id, ["baumy:read"]);
      expect(res.status).toBe(status);
      expect(await res.text()).toContain(`said ${code}`);
    }
  });
});

describe("metadata and configuration", () => {
  it("advertises the issuer, endpoints, scopes and S256 only", async () => {
    const req = new Request(`${ORIGIN}/.well-known/oauth-authorization-server`);
    const meta = await handleAuthServerMetadata(req, deps).json();
    expect(meta).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/api/mcp/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/mcp/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/mcp/oauth/register`,
      revocation_endpoint: `${ORIGIN}/api/mcp/oauth/revoke`,
      scopes_supported: ["baumy:read", "baumy:write"],
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
    const pr = await handleProtectedResourceMetadata(req, {
      env: { MCP_PUBLIC_URL: "https://baumy.example" },
    }).json();
    expect(pr).toEqual({
      resource: "https://baumy.example/api/mcp",
      authorization_servers: ["https://baumy.example"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["baumy:read", "baumy:write"],
    });
  });

  it("fails closed everywhere on Vercel without MCP_PUBLIC_URL", async () => {
    deps.env = { VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" };
    const req = () => json("/x", {});
    for (const res of [
      handleAuthServerMetadata(req(), deps),
      handleProtectedResourceMetadata(req(), deps),
      await handleRegister(req(), deps),
      await handleToken(req(), deps),
      await handleRevoke(req(), deps),
      await handleAuthorizeGet(req(), deps),
      await handleAuthorizePost(req(), deps),
    ]) {
      expect(res.status).toBe(503);
      expect(await res.text()).toContain("MCP_PUBLIC_URL");
    }
  });
});
