import { z } from "zod";
import {
  findMcpClient,
  hashMcpSecret,
  insertMcpAuthCode,
  listMcpConnections,
  revokeMcpGrant,
} from "@baumy/db/mcp-oauth";
import { MCP_SCOPES } from "@/lib/mcp/scopes";
import {
  PKCE_PATTERN,
  TOKEN_PREFIX,
  generateOpaqueToken,
} from "@/lib/mcp/tokens";
import { defineAction } from "./define";
import { fail } from "./result";

// MCP connections (SPEC §6.3, issue #23): the member's side of the OAuth
// server. All three need the member's OWN session (`session`: never the
// kiosk, an MCP token or brain), and are offered on the UI only.
//
// - authorize_mcp_client: the consent screen's Approve. Mints a single-use
//   code for the scopes the member ticked, bound to the member, the client,
//   its redirect URI and the PKCE challenge. The code is returned once and
//   never stored: the ledger keeps `code: null`, and only its hash is in
//   mcp_auth_codes.
// - list_mcp_connections: /settings/connections.
// - revoke_mcp_connection: Disconnect on that page.

const Scope = z.enum(MCP_SCOPES);

export interface AuthorizeMcpClientData {
  /** Null on a replay of the same approval: the code is shown once. */
  code: string | null;
  scopes: string[];
}

export const authorizeMcpClient = defineAction({
  name: "authorize_mcp_client",
  title: "Connect an app to Baumy",
  description:
    "Approves an app's request to reach Baumy as the signed-in member, with the scopes the member ticked, and returns a one-time authorization code for it.",
  consent: "Connect other apps to Baumy as you",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  rateLimit: { perMember: 20, perIp: 60, windowMs: 10 * 60_000 },
  input: z.strictObject({
    clientId: z.string().min(1).max(200),
    redirectUri: z.url().max(2000),
    codeChallenge: z.string().regex(PKCE_PATTERN),
    scopes: z
      .array(Scope)
      .min(1, "Tick at least one thing the app may do.")
      .max(MCP_SCOPES.length),
  }),
  async execute(ctx, input) {
    const client = await findMcpClient(ctx.db, input.clientId);
    if (!client) {
      return fail(
        "NOT_FOUND",
        "This app is not registered with Baumy. Add the connector again.",
      );
    }
    if (!client.redirectUris.includes(input.redirectUri)) {
      return fail(
        "FORBIDDEN",
        "This app asked to return to an address it did not register.",
      );
    }
    const scopes: string[] = MCP_SCOPES.filter((s) => input.scopes.includes(s));
    const code = generateOpaqueToken(TOKEN_PREFIX.AUTH_CODE, 24);
    const data: AuthorizeMcpClientData = { code, scopes };
    await insertMcpAuthCode(ctx.db, {
      codeHash: hashMcpSecret(code),
      clientId: client.clientId,
      memberId: ctx.actor.memberId!,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scopes,
      now: ctx.now,
    });
    return {
      ok: true,
      data,
      storedData: { code: null, scopes },
      audit: {
        entity: "mcp_client",
        entityId: client.clientId,
        payload: { clientName: client.clientName, scopes },
      },
    };
  },
});

export interface McpConnectionView {
  grantId: string;
  clientName: string;
  scopes: string[];
  grantedAt: string;
  lastUsedAt: string | null;
}

export const listMcpConnectionsAction = defineAction({
  name: "list_mcp_connections",
  title: "List connected apps",
  description:
    "Lists the apps (MCP clients such as Claude) the signed-in member has connected to Baumy, with what each may do and when it was last used.",
  consent: "See the apps you connected to Baumy",
  kind: "read",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({}),
  async execute(ctx) {
    const rows = await listMcpConnections(ctx.db, ctx.actor.memberId!, ctx.now);
    const data: McpConnectionView[] = rows.map((r) => ({
      grantId: r.grantId,
      clientName: r.clientName,
      scopes: r.scopes,
      grantedAt: r.grantedAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    }));
    return { ok: true, data };
  },
});

export interface RevokeMcpConnectionData {
  grantId: string;
  clientName: string;
}

export const revokeMcpConnection = defineAction({
  name: "revoke_mcp_connection",
  title: "Disconnect an app",
  description:
    "Disconnects one app the signed-in member connected to Baumy: its access and refresh tokens stop working at once.",
  consent: "Disconnect apps you connected to Baumy",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({
    grantId: z.uuid("Which connection?"),
  }),
  async execute(ctx, { grantId }) {
    const revoked = await revokeMcpGrant(ctx.db, {
      memberId: ctx.actor.memberId!,
      grantId,
      now: ctx.now,
    });
    if (!revoked) {
      return fail(
        "NOT_FOUND",
        "That connection doesn't exist or was already disconnected.",
      );
    }
    const data: RevokeMcpConnectionData = {
      grantId,
      clientName: revoked.clientName,
    };
    return {
      ok: true,
      data,
      audit: { entity: "mcp_grant", entityId: grantId, payload: data },
    };
  },
});
