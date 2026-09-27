import { and, eq, isNull } from "drizzle-orm";
import { createHttpDb } from "./index";
import { members } from "./schema";

// Member lookups the request path needs before any action runs: turning a
// Better Auth user into the household member acting (apps/web/lib/auth).

export interface ActiveMember {
  id: string;
  householdId: string;
  role: "admin" | "member";
  displayName: string;
}

/**
 * The active (not deactivated) member whose `auth_user_id` is this Better Auth
 * user, or null. A signed-in user without one is an account, not a housemate.
 */
export async function findActiveMemberByAuthUserId(
  authUserId: string,
): Promise<ActiveMember | null> {
  const [row] = await createHttpDb()
    .select({
      id: members.id,
      householdId: members.householdId,
      role: members.role,
      displayName: members.displayName,
    })
    .from(members)
    .where(
      and(eq(members.authUserId, authUserId), isNull(members.deactivatedAt)),
    )
    .limit(1);
  return row ?? null;
}
