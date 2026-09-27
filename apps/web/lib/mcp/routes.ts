import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable, Tx } from "@baumy/db";
import {
  consumeMcpAuthCode,
  findMcpClient,
  hashMcpSecret,
  insertMcpClient,
  insertMcpTokens,
  mcpHashesEqual,
  revokeMcpToken,
  rotateMcpRefreshToken,
  type McpAuthMethod,
} from "@baumy/db/mcp-oauth";
import type { RequestCtx } from "@/lib/actions/define";
import type { ActionResult } from "@/lib/actions/result";
import { now } from "@/lib/clock";
import { rejectCrossSite } from "@/lib/http/origin";
import { getClientIp, type RateLimiter } from "@/lib/rate-limit";
import {
  authorizeQuery,
  checkAuthorizeRequest,
  clientRedirect,
  pickAuthorizeParams,
} from "./authorize";
import {
  basicClientCredentials,
  corsJson,
  htmlError,
  htmlRedirect,
  oauthError,
  readBody,
} from "./http";
import { MCP_NOT_CONFIGURED, mcpPublicOrigin, oauthUrls } from "./origin";
import { isAllowedRedirectUri } from "./redirect-uris";
import { MCP_SCOPES, grantedScopes } from "./scopes";
import { TOKEN_PREFIX, generateOpaqueToken, verifyPkceS256 } from "./tokens";

// The MCP OAuth 2.1 authorization server (SPEC §6.3, issue #23). Ported from
// intake-tracker `apps/web/src/app/api/mcp/oauth/*` and `lib/mcp/*`, with
// Better Auth and an active `members` row in place of Neon Auth and
// ALLOWED_EMAILS. Each route file under app/ is one line calling in here.
//
//   GET  /.well-known/oauth-authorization-server   RFC 8414 metadata
//   GET  /.well-known/oauth-protected-resource     RFC 9728 metadata
//   POST /api/mcp/oauth/register    RFC 7591 DCR, redirect URIs allow-listed
//   GET  /api/mcp/oauth/authorize   check the request, then the consent page
//                                   (/oauth/consent: requireMemberPage)
//   POST /api/mcp/oauth/authorize   the consent form: authorize_mcp_client
//                                   through runAction, then back to the app
//   POST /api/mcp/oauth/token       authorization_code (PKCE S256) and
//                                   refresh_token (rotated in a transaction)
//   POST /api/mcp/oauth/revoke      RFC 7009
//
// The protocol endpoints (register, token, revoke) have no member behind
// them, only a client, so they are not registry actions; the two things a
// MEMBER does (approve, disconnect) are, and are audited. Every endpoint
// answers 503 while the issuer is unknown (MCP_PUBLIC_URL unset on Vercel).

export interface McpRouteDeps {
  env: Readonly<Record<string, string | undefined>>;
  db: () => Queryable;
  withTransaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  rateLimiter: RateLimiter;
  /** The signed-in person's UI context, or null (lib/actions/ui.ts). */
  requestCtx: (requestId: string | undefined) => Promise<RequestCtx | null>;
  runAction: (
    name: "authorize_mcp_client",
    input: unknown,
    ctx: RequestCtx,
  ) => Promise<ActionResult<{ code: string | null; scopes: string[] }>>;
}

/** Per client address. Generous, since claude.ai's servers share addresses. */
export const MCP_RATE_LIMITS = {
  register: { limit: 30, windowMs: 60 * 60_000 },
  token: { limit: 120, windowMs: 60_000 },
  revoke: { limit: 60, windowMs: 60_000 },
} as const;

async function limited(
  req: Request,
  deps: McpRouteDeps,
  bucket: keyof typeof MCP_RATE_LIMITS,
): Promise<Response | null> {
  const rl = await deps.rateLimiter.limit(
    `mcp:${bucket}:ip:${getClientIp(req.headers)}`,
    MCP_RATE_LIMITS[bucket],
  );
  if (rl.ok) return null;
  return oauthError(
    "temporarily_unavailable",
    `Too many requests. Try again in ${rl.retryAfterSeconds}s.`,
    429,
  );
}

function notConfigured(): Response {
  return oauthError("temporarily_unavailable", MCP_NOT_CONFIGURED, 503);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const AUTH_METHODS: McpAuthMethod[] = [
  "none",
  "client_secret_basic",
  "client_secret_post",
];

export function handleAuthServerMetadata(
  req: Request,
  deps: Pick<McpRouteDeps, "env">,
): Response {
  const origin = mcpPublicOrigin(req, deps.env);
  if (!origin) return notConfigured();
  const urls = oauthUrls(origin);
  return corsJson({
    issuer: urls.issuer,
    authorization_endpoint: urls.authorizationEndpoint,
    token_endpoint: urls.tokenEndpoint,
    registration_endpoint: urls.registrationEndpoint,
    revocation_endpoint: urls.revocationEndpoint,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    code_challenge_methods_supported: ["S256"],
  });
}

export function handleProtectedResourceMetadata(
  req: Request,
  deps: Pick<McpRouteDeps, "env">,
): Response {
  const origin = mcpPublicOrigin(req, deps.env);
  if (!origin) return notConfigured();
  const urls = oauthUrls(origin);
  return corsJson({
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_SCOPES],
  });
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration
// ---------------------------------------------------------------------------

const RegisterBody = z.object({
  client_name: z.string().trim().min(1).max(200).default("MCP client"),
  redirect_uris: z.array(z.url().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_basic", "client_secret_post"])
    .default("none"),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(200).optional(),
});

export async function handleRegister(
  req: Request,
  deps: McpRouteDeps,
): Promise<Response> {
  if (!mcpPublicOrigin(req, deps.env)) return notConfigured();
  const tooMany = await limited(req, deps, "register");
  if (tooMany) return tooMany;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "The body must be JSON.");
  }
  const parsed = RegisterBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return oauthError(
      "invalid_client_metadata",
      `${issue.path.join(".") || "body"}: ${issue.message}`,
    );
  }
  const body = parsed.data;
  const refused = body.redirect_uris.find((u) => !isAllowedRedirectUri(u));
  if (refused) {
    return oauthError(
      "invalid_redirect_uri",
      `redirect_uri not allowed: ${refused}`,
    );
  }

  const clientId = generateOpaqueToken(TOKEN_PREFIX.CLIENT_ID, 16);
  const secret =
    body.token_endpoint_auth_method === "none"
      ? null
      : generateOpaqueToken(TOKEN_PREFIX.CLIENT_SECRET, 32);
  const row = await insertMcpClient(deps.db(), {
    clientId,
    clientSecretHash: secret ? hashMcpSecret(secret) : null,
    clientName: body.client_name,
    redirectUris: body.redirect_uris,
    tokenEndpointAuthMethod: body.token_endpoint_auth_method,
    now: now(),
  });
  return corsJson(
    {
      client_id: row.clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      client_name: row.clientName,
      redirect_uris: row.redirectUris,
      token_endpoint_auth_method: row.tokenEndpointAuthMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

// ---------------------------------------------------------------------------
// Authorize
// ---------------------------------------------------------------------------

export const CONSENT_PATH = "/oauth/consent";

/**
 * GET: check the request, then hand over to the consent page, which is a
 * real page behind `requireMemberPage` (sign-in and /join included). A
 * relative Location, so the browser stays on whatever host it came in on.
 */
export async function handleAuthorizeGet(
  req: Request,
  deps: McpRouteDeps,
): Promise<Response> {
  if (!mcpPublicOrigin(req, deps.env))
    return htmlError(MCP_NOT_CONFIGURED, 503);
  const url = new URL(req.url);
  const check = await checkAuthorizeRequest(
    pickAuthorizeParams((n) => url.searchParams.get(n)),
    deps.db(),
  );
  if (!check.ok) return htmlError(check.message, 400);
  return new Response(null, {
    status: 302,
    headers: {
      location: `${CONSENT_PATH}?${authorizeQuery(check.params)}`,
      "cache-control": "no-store",
    },
  });
}

/**
 * POST: the consent form. Only the boxes the member ticked are granted, and
 * the code comes from `authorize_mcp_client` through runAction, which needs
 * the member's own session (a signed-in account with no member row gets no
 * code). The way back to the app is a page, never a 302 (http.ts).
 */
export async function handleAuthorizePost(
  req: Request,
  deps: McpRouteDeps,
): Promise<Response> {
  if (!mcpPublicOrigin(req, deps.env))
    return htmlError(MCP_NOT_CONFIGURED, 503);
  const crossSite = rejectCrossSite(req, deps.env as NodeJS.ProcessEnv);
  if (crossSite) return htmlError("Cross-site request refused.", 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return htmlError("The consent form could not be read.", 400);
  }
  const text = (n: string) => {
    const v = form.get(n);
    return typeof v === "string" ? v : null;
  };
  const check = await checkAuthorizeRequest(
    pickAuthorizeParams(text),
    deps.db(),
  );
  if (!check.ok) return htmlError(check.message, 400);
  const { params } = check;

  if (text("decision") !== "approve") {
    return htmlRedirect(
      clientRedirect(params, {
        error: "access_denied",
        description: "The member declined.",
      }),
    );
  }

  // `grant`, not `scope`: the request's own `scope` rides along hidden.
  const ticked = form.getAll("grant").filter((v) => typeof v === "string");
  const scopes = grantedScopes(check.offered, ticked);
  if (scopes.length === 0) {
    return new Response(null, {
      status: 303,
      headers: {
        location: `${CONSENT_PATH}?${authorizeQuery(params)}&consent_error=no_scope`,
        "cache-control": "no-store",
      },
    });
  }

  const ctx = await deps.requestCtx(text("requestId") ?? undefined);
  if (!ctx) return htmlError("Your session ended. Sign in and try again.", 401);
  const result = await deps.runAction(
    "authorize_mcp_client",
    {
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      scopes,
    },
    ctx,
  );
  if (!result.ok) {
    const status =
      result.code === "FORBIDDEN" || result.code === "SURFACE_FORBIDDEN"
        ? 403
        : result.code === "RATE_LIMITED"
          ? 429
          : 400;
    return htmlError(result.message, status);
  }
  if (!result.data.code) {
    return htmlError(
      "This approval was already used. Start connecting again from the app.",
      409,
    );
  }
  return htmlRedirect(clientRedirect(params, { code: result.data.code }));
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

type Fields = Record<string, string>;

/** Body fields, with Basic credentials filled in when the body has none. */
async function clientRequest(
  req: Request,
): Promise<{ ok: true; fields: Fields } | { ok: false; response: Response }> {
  const body = await readBody(req);
  if (!body.ok) {
    return {
      ok: false,
      response: oauthError("invalid_request", "The body could not be read."),
    };
  }
  const fields = body.fields;
  const basic = basicClientCredentials(req);
  if (basic) {
    fields.client_id ??= basic.clientId;
    fields.client_secret ??= basic.clientSecret;
  }
  return { ok: true, fields };
}

/** RFC 6749 §2.3: a public client sends no secret, a confidential one must. */
async function authenticateClient(
  db: Queryable,
  clientId: string | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!clientId || clientId.length > 200) return false;
  const client = await findMcpClient(db, clientId);
  if (!client) return false;
  if (client.tokenEndpointAuthMethod === "none") return true;
  if (!secret || !client.clientSecretHash) return false;
  return mcpHashesEqual(hashMcpSecret(secret), client.clientSecretHash);
}

function tokenResponse(
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  at: Date,
  scopes: string[],
): Response {
  return corsJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor((expiresAt.getTime() - at.getTime()) / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  });
}

const CodeGrant = z.object({
  code: z.string().min(1).max(512),
  redirect_uri: z.string().min(1).max(2000),
  code_verifier: z.string().min(1).max(512),
});

const RefreshGrant = z.object({
  refresh_token: z.string().min(1).max(512),
});

export async function handleToken(
  req: Request,
  deps: McpRouteDeps,
): Promise<Response> {
  if (!mcpPublicOrigin(req, deps.env)) return notConfigured();
  const tooMany = await limited(req, deps, "token");
  if (tooMany) return tooMany;
  const body = await clientRequest(req);
  if (!body.ok) return body.response;
  const f = body.fields;

  const grantType = f.grant_type;
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return oauthError(
      "unsupported_grant_type",
      "Only authorization_code and refresh_token are supported.",
    );
  }
  const db = deps.db();
  if (!(await authenticateClient(db, f.client_id, f.client_secret))) {
    return oauthError("invalid_client", "Client authentication failed.", 401);
  }
  const clientId = f.client_id!;
  const at = now();
  const accessToken = generateOpaqueToken(TOKEN_PREFIX.ACCESS, 32);
  const refreshToken = generateOpaqueToken(TOKEN_PREFIX.REFRESH, 32);

  if (grantType === "authorization_code") {
    const parsed = CodeGrant.safeParse(f);
    if (!parsed.success) {
      return oauthError(
        "invalid_request",
        "code, redirect_uri and code_verifier are required.",
      );
    }
    const consumed = await consumeMcpAuthCode(db, {
      codeHash: hashMcpSecret(parsed.data.code),
      clientId,
      redirectUri: parsed.data.redirect_uri,
      now: at,
    });
    if (!consumed) {
      return oauthError(
        "invalid_grant",
        "The code is unknown, used, expired, or for another client.",
      );
    }
    if (!verifyPkceS256(parsed.data.code_verifier, consumed.codeChallenge)) {
      return oauthError("invalid_grant", "The PKCE code_verifier is wrong.");
    }
    const { expiresAt } = await insertMcpTokens(db, {
      grantId: randomUUID(),
      tokenHash: hashMcpSecret(accessToken),
      refreshTokenHash: hashMcpSecret(refreshToken),
      clientId,
      memberId: consumed.memberId,
      scopes: consumed.scopes,
      grantedAt: at,
      now: at,
    });
    return tokenResponse(
      accessToken,
      refreshToken,
      expiresAt,
      at,
      consumed.scopes,
    );
  }

  const parsed = RefreshGrant.safeParse(f);
  if (!parsed.success) {
    return oauthError("invalid_request", "refresh_token is required.");
  }
  // Revoke the old pair and store the new one in ONE transaction: a failed
  // insert leaves the old refresh token usable (intake-tracker's lesson), and
  // two racing refreshes cannot both win.
  const rotated = await deps.withTransaction((tx) =>
    rotateMcpRefreshToken(tx as unknown as Queryable, {
      refreshHash: hashMcpSecret(parsed.data.refresh_token),
      clientId,
      tokenHash: hashMcpSecret(accessToken),
      refreshTokenHash: hashMcpSecret(refreshToken),
      now: at,
    }),
  );
  if (!rotated) {
    return oauthError(
      "invalid_grant",
      "The refresh token is unknown, used, revoked, expired, or for another client.",
    );
  }
  return tokenResponse(
    accessToken,
    refreshToken,
    rotated.expiresAt,
    at,
    rotated.scopes,
  );
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

/**
 * RFC 7009. Either token of a pair revokes the pair, for the presenting
 * client only. The answer is 200 whether or not the token was known, so the
 * endpoint cannot be used to probe for tokens (§2.2).
 */
export async function handleRevoke(
  req: Request,
  deps: McpRouteDeps,
): Promise<Response> {
  if (!mcpPublicOrigin(req, deps.env)) return notConfigured();
  const tooMany = await limited(req, deps, "revoke");
  if (tooMany) return tooMany;
  const body = await clientRequest(req);
  if (!body.ok) return body.response;
  const f = body.fields;
  const db = deps.db();
  if (!(await authenticateClient(db, f.client_id, f.client_secret))) {
    return oauthError("invalid_client", "Client authentication failed.", 401);
  }
  if (!f.token || f.token.length > 512) {
    return oauthError("invalid_request", "token is required.");
  }
  await revokeMcpToken(db, {
    tokenHash: hashMcpSecret(f.token),
    clientId: f.client_id!,
    now: now(),
  });
  return corsJson({});
}
