import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  claimInviteCode,
  findInviteCode,
  insertInviteCode,
  inviteCodeState,
  listInviteCodes,
  normalizeInviteCode,
  revokeInviteCode,
} from "../invite-codes";
import { inviteCodes, members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-27T10:00:00Z");
const HOUR = 60 * 60_000;

async function admin(): Promise<string> {
  const [row] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId: `admin_${Math.random()}`,
      displayName: "Admin",
      avatarSprite: "cat",
      color: "#112233",
      role: "admin",
    })
    .returning({ id: members.id });
  return row!.id;
}

async function mint(
  code: string,
  overrides: Partial<Parameters<typeof insertInviteCode>[1]> = {},
) {
  const row = await insertInviteCode(db(), {
    code,
    householdId: HOUSEHOLD_ID,
    role: "member",
    maxUses: 1,
    expiresAt: new Date(NOW.getTime() + 24 * HOUR),
    createdBy: await admin(),
    createdAt: NOW,
    ...overrides,
  });
  if (!row) throw new Error("mint failed");
  return row;
}

describe("normalizeInviteCode", () => {
  it("trims and lowercases", () => {
    expect(normalizeInviteCode("  Kiwi-Otter-7 ")).toBe("kiwi-otter-7");
  });
});

describe("insertInviteCode", () => {
  it("stores the code lowercased and refuses a duplicate", async () => {
    const row = await mint("ABCD-EFGH");
    expect(row.code).toBe("abcd-efgh");
    expect(row.useCount).toBe(0);
    await expect(
      insertInviteCode(db(), {
        code: "abcd-efgh",
        householdId: HOUSEHOLD_ID,
        role: "admin",
        maxUses: 5,
        expiresAt: NOW,
        createdBy: row.createdBy,
        createdAt: NOW,
      }),
    ).resolves.toBeNull();
    expect((await findInviteCode(db(), "abcd-efgh"))?.role).toBe("member");
  });

  it("refuses max_uses below 1 at the database", async () => {
    await expect(mint("zero-uses", { maxUses: 0 })).rejects.toThrow();
  });
});

describe("claimInviteCode", () => {
  it("takes one use, whatever the case typed", async () => {
    await mint("claim-me", { maxUses: 2 });
    const first = await claimInviteCode(db(), " CLAIM-me", NOW);
    expect(first?.useCount).toBe(1);
    const second = await claimInviteCode(db(), "claim-me", NOW);
    expect(second?.useCount).toBe(2);
    await expect(claimInviteCode(db(), "claim-me", NOW)).resolves.toBeNull();
    expect((await findInviteCode(db(), "claim-me"))?.useCount).toBe(2);
  });

  it("gives exactly one of two racing claims the last use", async () => {
    await mint("last-use", { maxUses: 1 });
    const results = await Promise.all([
      claimInviteCode(db(), "last-use", NOW),
      claimInviteCode(db(), "last-use", NOW),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect((await findInviteCode(db(), "last-use"))?.useCount).toBe(1);
  });

  it("refuses an expired code, from the instant it expires", async () => {
    const row = await mint("soon-gone");
    const justBefore = new Date(row.expiresAt.getTime() - 1);
    await expect(
      claimInviteCode(db(), "soon-gone", row.expiresAt),
    ).resolves.toBeNull();
    await expect(
      claimInviteCode(db(), "soon-gone", justBefore),
    ).resolves.not.toBeNull();
  });

  it("refuses a revoked code and an unknown one", async () => {
    await mint("revoked-one", { maxUses: 3 });
    expect(await revokeInviteCode(db(), "revoked-one", NOW)).not.toBeNull();
    await expect(claimInviteCode(db(), "revoked-one", NOW)).resolves.toBeNull();
    await expect(claimInviteCode(db(), "no-such", NOW)).resolves.toBeNull();
  });

  it("gives the use back when the transaction rolls back", async () => {
    await mint("rollback");
    await expect(
      t.db().transaction(async (tx) => {
        const row = await claimInviteCode(
          tx as unknown as Queryable,
          "rollback",
          NOW,
        );
        expect(row?.useCount).toBe(1);
        throw new Error("member insert failed");
      }),
    ).rejects.toThrow("member insert failed");
    expect((await findInviteCode(db(), "rollback"))?.useCount).toBe(0);
  });

  it("cannot push use_count past max_uses even by a direct write", async () => {
    await mint("capped", { maxUses: 1 });
    await expect(
      t
        .db()
        .update(inviteCodes)
        .set({ useCount: 2 })
        .where(eq(inviteCodes.code, "capped")),
    ).rejects.toThrow();
  });
});

describe("inviteCodeState", () => {
  const base = {
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + HOUR),
    maxUses: 2,
    useCount: 1,
  };

  it("names each state, revoked before expired before used up", () => {
    expect(inviteCodeState(base, NOW)).toBe("active");
    expect(inviteCodeState({ ...base, useCount: 2 }, NOW)).toBe("used_up");
    expect(inviteCodeState({ ...base, expiresAt: NOW, useCount: 2 }, NOW)).toBe(
      "expired",
    );
    expect(
      inviteCodeState(
        { ...base, revokedAt: NOW, expiresAt: NOW, useCount: 2 },
        NOW,
      ),
    ).toBe("revoked");
  });
});

describe("revokeInviteCode", () => {
  it("revokes once; a second revoke finds nothing to change", async () => {
    await mint("to-revoke");
    const first = await revokeInviteCode(db(), "TO-REVOKE", NOW);
    expect(first?.revokedAt?.toISOString()).toBe(NOW.toISOString());
    await expect(
      revokeInviteCode(db(), "to-revoke", new Date(NOW.getTime() + HOUR)),
    ).resolves.toBeNull();
    expect((await findInviteCode(db(), "to-revoke"))?.revokedAt).toEqual(NOW);
    await expect(revokeInviteCode(db(), "nope", NOW)).resolves.toBeNull();
  });
});

describe("listInviteCodes", () => {
  it("lists newest first with the creator's name", async () => {
    await mint("older", { createdAt: new Date(NOW.getTime() - HOUR) });
    await mint("newer");
    const list = await listInviteCodes(db(), HOUSEHOLD_ID);
    expect(list.map((c) => c.code)).toEqual(["newer", "older"]);
    expect(list[0]?.createdByName).toBe("Admin");
    expect(await listInviteCodes(db(), HOUSEHOLD_ID, 1)).toHaveLength(1);
  });
});
