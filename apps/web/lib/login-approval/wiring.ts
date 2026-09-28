import "server-only";

import { randomBytes, randomInt } from "node:crypto";
import { after } from "next/server";
import { authMayServe, getAuth } from "@baumy/auth";
import { createHttpDb, withTransaction, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  claimApprovedLoginRequest,
  findLoginCandidate,
  findLoginRequestBySecret,
  insertLoginRequest,
  isLoginLocked,
} from "@baumy/db/login-requests";
import { auditEvents } from "@baumy/db/schema";
import { now } from "@/lib/clock";
import { brainClient } from "@/lib/integrations/brain";
import { rateLimiter } from "@/lib/rate-limit";
import type { LoginApprovalDeps } from "./flow";

// The real dependencies of the "Sign in with Baumy" routes (issue #80); the
// tests pass their own.

const db = () => createHttpDb() as unknown as Queryable;

export function loginApprovalDeps(): LoginApprovalDeps {
  return {
    now,
    rateLimiter,
    randomInt: (min, max) => randomInt(min, max),
    randomSecret: () => randomBytes(32).toString("base64url"),
    findCandidate: (email) => findLoginCandidate(db(), HOUSEHOLD_ID, email),
    isLocked: (memberId, at) => isLoginLocked(db(), memberId, at),
    // The request and, for a real member, its audit row, in one transaction.
    // Nobody is signed in yet, so this is not an action: like the kiosk PIN
    // lock, it is one of the audit rows written outside runAction (ADR 0006).
    createRequest: ({ audit, ...input }) =>
      withTransaction(async (tx) => {
        const q = tx as unknown as Queryable;
        const created = await insertLoginRequest(q, input);
        if (audit && input.memberId) {
          await q.insert(auditEvents).values({
            actorMemberId: input.memberId,
            source: "ui",
            action: "request_login",
            entity: "login_request",
            entityId: created.id,
            payload: { device: input.device, ip: audit.ip },
            at: input.now,
          });
        }
        return created;
      }),
    findBySecret: (secret, at) => findLoginRequestBySecret(db(), secret, at),
    claim: (secret, at) => claimApprovedLoginRequest(db(), secret, at),
    sendApproval: (message) => brainClient().requestLoginApproval(message),
    afterResponse: (fn) =>
      after(async () => {
        try {
          await fn();
        } catch (err) {
          console.error("[login-approval] after the response", err);
        }
      }),
    signIn: async (authUserId, headers) => {
      const { headers: out } = await getAuth().api.signInApproved({
        body: { userId: authUserId },
        headers,
        returnHeaders: true,
      });
      return out.getSetCookie();
    },
    authMayServe: () => authMayServe(process.env),
    logError: (message, err) =>
      err === undefined ? console.error(message) : console.error(message, err),
  };
}
