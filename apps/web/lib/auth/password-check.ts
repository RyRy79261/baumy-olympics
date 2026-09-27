import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@baumy/auth";

// Re-authentication for sensitive changes (SPEC §6.2: changing a kiosk PIN
// needs the current password or a fresh session). Better Auth checks the
// password of the session in this request's headers, reading the session
// from the database rather than the cookie cache.

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
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      typeof err.statusCode === "number" &&
      err.statusCode < 500
    ) {
      return false;
    }
    throw err;
  }
}
