import { z } from "zod";
import {
  BRAIN_SCOPE,
  SERVICE_TOKEN_NAME,
  mintServiceToken,
  revokeServiceToken,
} from "@baumy/db/service-tokens";
import { confirmedActor, isFailure } from "./account-security";
import { defineAction } from "./define";
import { fail } from "./result";

// /admin/connections (issue #104): the service tokens baumy-brain sends to
// /api/v1/actions, managed without a terminal. Admin only, UI only, and
// never the kiosk (the admin gate needs a real session). Each write first
// asks whether the session it came in on still exists (`liveActor`, as the
// Security page does), so a device signed out elsewhere cannot use its
// cookie cache to mint a token.
//
// Creating and rotating hand out a new way into the household's data, and
// revoking cuts brain off, so each also needs "Confirm it's you"
// (`requireRecentAuth`, issue #135): a session signed in, or confirmed by any
// of the admin's methods, in the last 10 minutes. The plaintext token is in
// the result once: `storedData` keeps it out of the idempotency ledger, the
// audit row names only the token, and only its sha256 reaches the database
// (packages/db/src/service-tokens.ts, shared with the CLI).
//
// ORDER MATTERS in `confirmedActor`: the sudo window is read BEFORE
// `liveActor` share-locks the session row. Before issue #135 the password was
// checked here by Better Auth's verifyPassword, which reads the session on
// its own connection and may refresh it (an UPDATE of that row); holding
// `FOR SHARE` on it first hung the request (PR #105 review). The proofs now
// run in `confirm_identity`, which keeps the same order.

/** What every token minted here may do: call the brain surface. */
export const SERVICE_TOKEN_SCOPES = [BRAIN_SCOPE];

export const DEFAULT_SERVICE_TOKEN_NAME = "baumy-brain";

const SIGNED_OUT =
  "This device was signed out. Sign in again to manage service tokens.";

const Name = z
  .string()
  .trim()
  .regex(
    SERVICE_TOKEN_NAME,
    "Use lowercase letters, digits and dashes, like baumy-brain.",
  );

export interface ServiceTokenData {
  name: string;
  scopes: string[];
  /** The plaintext, shown once. Null on a replay: it is never stored. */
  token: string | null;
}

const shown = (data: ServiceTokenData) => ({
  data,
  storedData: { ...data, token: null },
  audit: {
    entity: "service_token",
    entityId: data.name,
    payload: { name: data.name, scopes: data.scopes },
  },
});

const common = {
  surfaces: ["ui"],
  requires: "admin",
  kind: "write",
  rateLimit: { perMember: 10, perIp: 30, windowMs: 15 * 60_000 },
} as const;

export const createServiceToken = defineAction({
  ...common,
  name: "create_service_token",
  title: "Create a service token",
  description:
    "Creates a service token (for baumy-brain) that may call the brain actions, and shows it once. Only its hash is stored. Needs a recent 'Confirm it's you'.",
  consent: "Create service tokens for baumy-brain",
  risk: "confirm",
  input: z.strictObject({
    name: Name.default(DEFAULT_SERVICE_TOKEN_NAME),
  }),
  async execute(ctx, { name }) {
    const actor = await confirmedActor(ctx, SIGNED_OUT);
    if (isFailure(actor)) return actor;
    const minted = await mintServiceToken(ctx.db, {
      name,
      scopes: SERVICE_TOKEN_SCOPES,
      now: ctx.now,
      mode: "mint",
    });
    if (!minted.ok) {
      return fail(
        "SERVICE_TOKEN_EXISTS",
        `${name} already has a live token. Rotate it to get a new one.`,
      );
    }
    return {
      ok: true,
      ...shown({
        name: minted.row.name,
        scopes: minted.row.scopes,
        token: minted.token,
      }),
    };
  },
});

export const rotateServiceToken = defineAction({
  ...common,
  name: "rotate_service_token",
  title: "Rotate a service token",
  description:
    "Replaces a live service token with a new one, shown once. The old token stops working at once, so brain needs the new one before its next call. Needs a recent 'Confirm it's you'.",
  consent: "Replace baumy-brain's service token",
  risk: "destructive",
  input: z.strictObject({ name: Name }),
  async execute(ctx, { name }) {
    const actor = await confirmedActor(ctx, SIGNED_OUT);
    if (isFailure(actor)) return actor;
    // One transaction (runAction's): never two live tokens, never none.
    const minted = await mintServiceToken(ctx.db, {
      name,
      scopes: SERVICE_TOKEN_SCOPES,
      now: ctx.now,
      mode: "rotate",
      requireLive: true,
    });
    if (!minted.ok) {
      return fail(
        "NOT_FOUND",
        `${name} has no live token to rotate. Create one instead.`,
      );
    }
    return {
      ok: true,
      ...shown({
        name: minted.row.name,
        scopes: minted.row.scopes,
        token: minted.token,
      }),
    };
  },
});

export const revokeServiceTokenAction = defineAction({
  name: "revoke_service_token",
  title: "Revoke a service token",
  description:
    "Revokes a live service token. Brain's next call with it gets a 401 until it has a new token. Needs a recent 'Confirm it's you'.",
  consent: "Cut baumy-brain off",
  ...common,
  risk: "destructive",
  input: z.strictObject({ name: Name }),
  async execute(ctx, { name }) {
    const actor = await confirmedActor(ctx, SIGNED_OUT);
    if (isFailure(actor)) return actor;
    const revoked = await revokeServiceToken(ctx.db, { name, now: ctx.now });
    if (!revoked) {
      return fail("NOT_FOUND", `${name} has no live token. It's already off.`);
    }
    return {
      ok: true,
      data: { name },
      audit: { entity: "service_token", entityId: name, payload: { name } },
    };
  },
});
