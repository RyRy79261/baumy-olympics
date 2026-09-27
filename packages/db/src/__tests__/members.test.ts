import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import { findActiveMemberByAuthUserId } from "../members";
import { members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();

async function seed(authUserId: string, deactivatedAt: Date | null = null) {
  const [row] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId,
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#ff8800",
      role: "admin",
      deactivatedAt,
    })
    .returning();
  return row!;
}

describe("findActiveMemberByAuthUserId", () => {
  it("returns the member linked to the auth user", async () => {
    const row = await seed("u_1");
    await expect(findActiveMemberByAuthUserId("u_1")).resolves.toEqual({
      id: row.id,
      householdId: HOUSEHOLD_ID,
      role: "admin",
      displayName: "Ryan",
    });
  });

  it("returns null for an unknown user and for a deactivated member", async () => {
    await seed("u_gone", new Date("2026-01-01T00:00:00Z"));
    await expect(findActiveMemberByAuthUserId("u_gone")).resolves.toBeNull();
    await expect(findActiveMemberByAuthUserId("u_none")).resolves.toBeNull();
  });
});
