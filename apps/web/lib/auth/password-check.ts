import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@baumy/auth";

// The password as one proof of "Confirm it's you" (issue #135; before it,
// changing a kiosk PIN needed the password or a fresh session, SPEC §6.2).
// Better Auth checks the password of the session in this request's headers,
// reading the session from the database rather than the cookie cache.

/**
 * Better Auth's answer to a wrong proof or a missing session: an APIError
 * with a 4xx status. Anything else is an outage.
 */
export function isClientRefusal(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "statusCode" in err &&
    typeof err.statusCode === "number" &&
    err.statusCode < 500
  );
}

/**
 * Whether `password` is the signed-in user's current password. False for a
 * wrong password and for an account with no password (Google only).
 */
export async function verifyCurrentPassword(
  password: string,
): Promise<boolean> {
  try {
    await getAuth().api.verifyPassword({
      body: { password },
      headers: await headers(),
    });
    return true;
  } catch (err) {
    // Better Auth answers a wrong password or a missing session with an
    // APIError (status 400/401). Anything else is an outage: let it throw.
    if (isClientRefusal(err)) return false;
    throw err;
  }
}
