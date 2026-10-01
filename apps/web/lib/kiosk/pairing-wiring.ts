import "server-only";

import { randomBytes } from "node:crypto";
import { createHttpDb, withTransaction, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  claimApprovedKioskPairing,
  findKioskPairingBySecret,
  insertKioskPairingRequest,
} from "@baumy/db/kiosk-pairing";
import { now } from "@/lib/clock";
import { generateKioskPairingCode } from "@/lib/codes";
import { rateLimiter } from "@/lib/rate-limit";
import { generateKioskToken } from "./cookies";
import type { KioskPairingDeps } from "./pairing";

// The real dependencies of the kiosk pairing routes (issue #126); the tests
// pass their own.

const db = () => createHttpDb() as unknown as Queryable;

export function kioskPairingDeps(): KioskPairingDeps {
  return {
    now,
    rateLimiter,
    randomSecret: () => randomBytes(32).toString("base64url"),
    newCode: generateKioskPairingCode,
    newToken: generateKioskToken,
    createRequest: (input) =>
      insertKioskPairingRequest(db(), { ...input, householdId: HOUSEHOLD_ID }),
    findBySecret: (secret, at) => findKioskPairingBySecret(db(), secret, at),
    // Two compare-and-set UPDATEs, so the pooled driver's transaction.
    claim: (input) =>
      withTransaction((tx) =>
        claimApprovedKioskPairing(tx as unknown as Queryable, input),
      ),
    logError: (message, err) =>
      err === undefined ? console.error(message) : console.error(message, err),
  };
}
