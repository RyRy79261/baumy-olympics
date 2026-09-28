import "server-only";

import { randomBytes, randomInt } from "node:crypto";
import { after } from "next/server";
import { authMayServe, getAuth } from "@baumy/auth";
import { createHttpDb, type Queryable } from "@baumy/db";
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
import { signInWithBaumyEnabled } from "./flag";
import type { LoginApprovalDeps } from "./flow";

// The real dependencies of the "Sign in with Baumy" routes (issue #80); the
// tests pass their own.

const db = () => createHttpDb() as unknown as Queryable;

export function loginApprovalDeps(): LoginApprovalDeps {
  return {
    enabled: () => signInWithBaumyEnabled(process.env),
    now,
    rateLimiter,
    randomInt: (min, max) => randomInt(min, max),
    randomSecret: () => randomBytes(32).toString("base64url"),
    findCandidate: (email) => findLoginCandidate(db(), HOUSEHOLD_ID, email),
    isLocked: (memberId, at) => isLoginLocked(db(), memberId, at),
    createRequest: (input) => insertLoginRequest(db(), input),
    // Nobody is signed in yet, so this is not an action: like the kiosk PIN
    // lock, it is one of the audit rows written outside runAction (ADR 0006).
    // The requester is anonymous (actor null); the member is the target.
    auditRequest: async ({ memberId, requestId, device, ip, now: at }) => {
      await db().insert(auditEvents).values({
        actorMemberId: null,
        source: "ui",
        action: "request_login",
        entity: "member",
        entityId: memberId,
        payload: { requestId, device, ip },
        at,
      });
    },
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
