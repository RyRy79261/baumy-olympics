import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHttpDb, isLocalProxy, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  actionRequests,
  auditEvents,
  inviteCodes,
  members,
} from "@baumy/db/schema";
import {
  FIXED_NOW,
  accountActor,
  allowAll,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { REGISTRY } from "./registry";
import { createRunner, defaultDeps } from "./run";

// The membership races on real Postgres (Docker, through the Neon WebSocket
// proxy), where every request is its own transaction on its own connection.
// PGlite runs one statement at a time, so only here can two redeems really
// meet at the invite row's lock.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const db = () => createHttpDb() as unknown as Queryable;
const run = createRunner(REGISTRY, { ...defaultDeps, rateLimiter: allowAll });
const HOUR = 60 * 60_000;

const seeded: string[] = [];
const codes: string[] = [];
const userIds: string[] = [];

async function member(role: "admin" | "member" = "member"): Promise<string> {
  const id = await seedMember(db(), {
    authUserId: `local_${randomUUID()}`,
    role,
  });
  seeded.push(id);
  return id;
}

async function inviteCode(maxUses: number): Promise<string> {
  const code = `local-${randomUUID()}`;
  codes.push(code);
  await db()
    .insert(inviteCodes)
    .values({
      code,
      householdId: HOUSEHOLD_ID,
      maxUses,
      expiresAt: new Date(FIXED_NOW.getTime() + HOUR),
      createdBy: await member("admin"),
      createdAt: FIXED_NOW,
    });
  return code;
}

function account(): string {
  const id = `local_join_${randomUUID()}`;
  userIds.push(id);
  return id;
}

afterAll(async () => {
  const joined = userIds.length
    ? await db()
        .select({ id: members.id })
        .from(members)
        .where(inArray(members.authUserId, userIds))
    : [];
  const ids = [...seeded, ...joined.map((m) => m.id)];
  if (codes.length) {
    await db().delete(inviteCodes).where(inArray(inviteCodes.code, codes));
  }
  if (ids.length === 0) return;
  await db().delete(auditEvents).where(inArray(auditEvents.actorMemberId, ids));
  await db()
    .delete(actionRequests)
    .where(inArray(actionRequests.actorMemberId, ids));
  await db().delete(members).where(inArray(members.id, ids));
});

describe("redeem_invite under concurrent requests", () => {
  it("two concurrent redeems of a max_uses=1 code produce exactly one member", async () => {
    const code = await inviteCode(1);
    const [a, b] = [account(), account()];
    const results = await Promise.all(
      [a, b].map((userId) =>
        run(
          "redeem_invite",
          { code, displayName: "Racer" },
          ctxFor(accountActor(userId)),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ code: "INVITE_USED_UP" }),
    ]);
    const joined = await db()
      .select()
      .from(members)
      .where(or(eq(members.authUserId, a), eq(members.authUserId, b)));
    expect(joined).toHaveLength(1);
    const [row] = await db()
      .select({ uses: inviteCodes.useCount })
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));
    expect(row?.uses).toBe(1);
  });

  it("a burst of ten accounts on a three-use code lets exactly three in", async () => {
    const code = await inviteCode(3);
    const accounts = Array.from({ length: 10 }, account);
    const results = await Promise.all(
      accounts.map((userId) =>
        run(
          "redeem_invite",
          { code, displayName: "Burst" },
          ctxFor(accountActor(userId)),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const joined = await db()
      .select()
      .from(members)
      .where(inArray(members.authUserId, accounts));
    expect(joined).toHaveLength(3);
  });

  it("one account redeeming twice at once joins once and spends one use", async () => {
    const code = await inviteCode(5);
    const userId = account();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        run(
          "redeem_invite",
          { code, displayName: "Twice" },
          ctxFor(accountActor(userId)),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [row] = await db()
      .select({ uses: inviteCodes.useCount })
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));
    expect(row?.uses).toBe(1);
  });
});

describe("manage_members under concurrent requests", () => {
  it("two admins demoting each other at once do not deadlock", async () => {
    // Both lock every active admin in id order before touching either row,
    // so one waits for the other instead of each holding what the other
    // needs. The acting member's row is already key-share locked by the
    // ledger's foreign key, which is why those locks are FOR NO KEY UPDATE.
    // A third admin stays, so both demotions may succeed.
    await member("admin");
    for (let round = 0; round < 10; round++) {
      const [x, y] = [await member("admin"), await member("admin")];
      const results = await Promise.all([
        run(
          "manage_members",
          { op: "set_role", memberId: y, role: "member" },
          ctxFor(sessionActor(x, "admin")),
        ),
        run(
          "manage_members",
          { op: "set_role", memberId: x, role: "member" },
          ctxFor(sessionActor(y, "admin")),
        ),
      ]);
      expect(results.filter((r) => !r.ok)).toEqual([]);
    }
  });
});
