import { z } from "zod";
import { createHttpDb, type Queryable } from "@baumy/db";
import { findMcpClient } from "@baumy/db/mcp-oauth";
import { PKCE_PATTERN } from "./tokens";
import { offeredScopes, type McpScope } from "./scopes";

// The authorization request (RFC 6749 §4.1.1 with PKCE, RFC 7636), checked
// the same way by the authorize route, the consent page and the approval.
// Ported from intake-tracker `app/api/mcp/oauth/authorize/route.ts`.
//
// A request with an unknown client or an unregistered redirect URI is never
// sent back to that URI (RFC 6749 §4.1.2.1): the person sees the error.

export const AuthorizeParams = z.object({
  response_type: z.literal("code", "Only response_type=code is supported."),
  client_id: z.string().min(1).max(200),
  redirect_uri: z.url().max(2000),
  code_challenge: z
    .string()
    .regex(PKCE_PATTERN, "code_challenge must be an S256 PKCE challenge."),
  // S256 only, matching `code_challenge_methods_supported`.
  code_challenge_method: z.literal("S256", "Only S256 PKCE is supported."),
  state: z.string().min(1).max(512),
  scope: z.string().max(200).optional(),
});
export type AuthorizeParams = z.infer<typeof AuthorizeParams>;

/** The OAuth parameters carried through the consent page, in order. */
export const AUTHORIZE_PARAM_NAMES = Object.keys(
  AuthorizeParams.shape,
) as (keyof AuthorizeParams)[];

export type AuthorizeCheck =
  | {
      ok: true;
      params: AuthorizeParams;
      clientName: string;
      offered: McpScope[];
    }
  | { ok: false; message: string };

/** Only our own parameter names, each once (the first value wins). */
export function pickAuthorizeParams(
  get: (name: string) => string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const v = get(name);
    if (typeof v === "string") out[name] = v;
  }
  return out;
}

export async function checkAuthorizeRequest(
  raw: Record<string, string>,
  db: Queryable = createHttpDb() as unknown as Queryable,
): Promise<AuthorizeCheck> {
  const parsed = AuthorizeParams.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return {
      ok: false,
      message: `The app asked in a way Baumy does not understand (${issue.path.join(".")}: ${issue.message})`,
    };
  }
  const client = await findMcpClient(db, parsed.data.client_id);
  if (!client) {
    return {
      ok: false,
      message:
        "This app is not registered with Baumy. Add the connector again.",
    };
  }
  if (!client.redirectUris.includes(parsed.data.redirect_uri)) {
    return {
      ok: false,
      message: "This app asked to return to an address it did not register.",
    };
  }
  return {
    ok: true,
    params: parsed.data,
    clientName: client.clientName,
    offered: offeredScopes(parsed.data.scope),
  };
}

/** The params as a query string, for the consent page and sign-in trip. */
export function authorizeQuery(params: AuthorizeParams): string {
  const q = new URLSearchParams();
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const v = params[name];
    if (v !== undefined) q.set(name, v);
  }
  return q.toString();
}

/** `redirect_uri` with the code or the error, and the state (§4.1.2). */
export function clientRedirect(
  params: Pick<AuthorizeParams, "redirect_uri" | "state">,
  result: { code: string } | { error: string; description: string },
): string {
  const url = new URL(params.redirect_uri);
  if ("code" in result) {
    url.searchParams.set("code", result.code);
  } else {
    url.searchParams.set("error", result.error);
    url.searchParams.set("error_description", result.description);
  }
  url.searchParams.set("state", params.state);
  return url.toString();
}
