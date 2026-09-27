import { HOUSEHOLD_ID } from "@baumy/db/household";
import { members } from "@baumy/db/schema";
import type { Queryable } from "@baumy/db";
import type { RequestCtx } from "@/lib/actions/define";
import type { Actor, MemberActor, MemberRole } from "@/lib/auth";
import type { RateLimiter } from "@/lib/rate-limit";

// Shared arrangements for the action tests (PGlite and Docker Postgres).
// Outside lib/, so coverage counts only the code under test.

export const FIXED_NOW = new Date("2026-09-27T10:00:00.000Z");

let seq = 0;

/** Insert an active member and return its id. */
export async function seedMember(
  db: Queryable,
  overrides: Partial<typeof members.$inferInsert> = {},
): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId: `user_${seq}_${Math.random().toString(36).slice(2)}`,
      displayName: `Member ${seq}`,
      avatarSprite: "cat",
      color: "#336699",
      role: "member",
      ...overrides,
    })
    .returning({ id: members.id });
  return row!.id;
}

export function sessionActor(
  memberId: string | undefined,
  role: MemberRole = "member",
): MemberActor {
  return {
    kind: "member",
    userId: `u_${memberId ?? "none"}`,
    email: "someone@example.com",
    name: "Someone",
    ...(memberId ? { memberId, role } : {}),
  };
}

export function kioskActor(memberId?: string): Actor {
  return {
    kind: "kiosk",
    deviceId: "dev_1",
    ...(memberId ? { memberId } : {}),
  };
}

let requestSeq = 0;
export function freshRequestId(): string {
  requestSeq += 1;
  return `req-${Date.now().toString(36)}-${requestSeq}`;
}

export function ctxFor(
  actor: Actor,
  overrides: Partial<RequestCtx> = {},
): RequestCtx {
  return {
    actor,
    source: "ui",
    householdId: HOUSEHOLD_ID,
    requestId: freshRequestId(),
    now: FIXED_NOW,
    ...overrides,
  };
}

export const allowAll: RateLimiter = {
  limit: async () => ({ ok: true, retryAfterSeconds: 0 }),
};
