import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTestDb } from "./_harness";
import { createHttpDb, createPooledDb, withTransaction } from "../index";
import { HOUSEHOLD_ID, HOUSEHOLD_NAME, HOUSEHOLD_TZ } from "../household";
import * as schema from "../schema";

// The harness itself: it replays every committed migration, the code under
// test reaches the same database, and each test starts from the migrated state.
// The tests in this file run in order, and the second relies on the first.

const journal = JSON.parse(
  readFileSync(
    new URL("../../migrations/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: { tag: string }[] };

const member = {
  householdId: HOUSEHOLD_ID,
  displayName: "Ryan",
  avatarSprite: "cat-orange",
  color: "#ff8800",
} satisfies typeof schema.members.$inferInsert;

describe("useTestDb", () => {
  const h = useTestDb();

  it("replays every committed migration", async () => {
    expect(journal.entries.length).toBeGreaterThan(0);
    const { rows } = await h
      .client()
      .query<{ n: number }>(
        "select count(*)::int as n from drizzle.__drizzle_migrations",
      );
    expect(rows[0]!.n).toBe(journal.entries.length);

    const tables = await h
      .client()
      .query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public' order by 1",
      );
    expect(tables.rows.map((r) => r.tablename)).toEqual([
      "account",
      "action_rate_limit",
      "action_requests",
      "ai_usage",
      "audit_events",
      "chore_rule_versions",
      "chores",
      "completion_scores",
      "completions",
      "disputes",
      "households",
      "invite_codes",
      "kiosk_devices",
      "login_requests",
      "mcp_access_tokens",
      "mcp_auth_codes",
      "mcp_oauth_clients",
      "members",
      "notes",
      "passkey",
      "point_adjustments",
      "pot_contributions",
      "rate_limit",
      "reminder_acks",
      "reminders",
      "seasons",
      "service_tokens",
      "session",
      "telegram_link_codes",
      "two_factor",
      "user",
      "verification",
      "weight_suggestions",
    ]);
  });

  it("points createHttpDb and createPooledDb at the test database", async () => {
    await createHttpDb().insert(schema.members).values(member);
    const pooled = await createPooledDb()
      .db.select()
      .from(schema.members)
      .where(eq(schema.members.displayName, "Ryan"));
    expect(pooled).toHaveLength(1);

    const [event] = await h
      .db()
      .insert(schema.auditEvents)
      .values({
        actorMemberId: pooled[0]!.id,
        source: "ui",
        action: "test",
        entity: "member",
      })
      .returning();
    expect(event!.id).toBe(1);
  });

  it("starts the next test from the migrated state", async () => {
    // The member from the previous test is gone, the seeded household is back,
    // and sequences restart.
    expect(await h.db().select().from(schema.members)).toEqual([]);
    expect(await h.db().select().from(schema.households)).toHaveLength(1);

    const [m] = await h.db().insert(schema.members).values(member).returning();
    const [event] = await h
      .db()
      .insert(schema.auditEvents)
      .values({
        actorMemberId: m!.id,
        source: "kiosk",
        action: "test",
        entity: "member",
      })
      .returning();
    expect(event!.id).toBe(1);
  });
});

describe("seeded household", () => {
  const h = useTestDb();

  it("is the one household, with the id, name and tz the code uses", async () => {
    const rows = await h.db().select().from(schema.households);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: HOUSEHOLD_ID,
      name: HOUSEHOLD_NAME,
      tz: HOUSEHOLD_TZ,
    });
  });
});

describe("withTransaction", () => {
  const h = useTestDb();

  it("commits when the callback resolves", async () => {
    const id = await withTransaction(async (tx) => {
      const [m] = await tx.insert(schema.members).values(member).returning();
      return m!.id;
    });
    expect(
      await h
        .db()
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, id)),
    ).toHaveLength(1);
  });

  it("rolls every statement back and rethrows when the callback throws", async () => {
    const boom = new Error("boom");
    await expect(
      withTransaction(async (tx) => {
        await tx.insert(schema.members).values(member);
        await tx.insert(schema.members).values({ ...member, color: "#000" });
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await h.db().select().from(schema.members)).toEqual([]);
  });
});

describe("platform tables", () => {
  const h = useTestDb();

  async function aMember() {
    const [m] = await h.db().insert(schema.members).values(member).returning();
    return m!;
  }

  it("keys action_requests on (actor, source, request id)", async () => {
    const m = await aMember();
    const row = {
      actorMemberId: m.id,
      source: "ui" as const,
      requestId: "r1",
      action: "log_completion",
      inputHash: "h",
    };
    await h.db().insert(schema.actionRequests).values(row);
    // Same request id from another surface is a different request.
    await h
      .db()
      .insert(schema.actionRequests)
      .values({ ...row, source: "kiosk" });
    expect(await h.db().select().from(schema.actionRequests)).toHaveLength(2);
    await expect(
      h.db().insert(schema.actionRequests).values(row),
    ).rejects.toThrow();
  });

  it("defaults a claimed action request to pending", async () => {
    const m = await aMember();
    const [row] = await h
      .db()
      .insert(schema.actionRequests)
      .values({
        actorMemberId: m.id,
        source: "mcp",
        requestId: "r1",
        action: "a",
        inputHash: "h",
      })
      .returning();
    expect(row!.status).toBe("pending");
  });

  it("stores exactly the five surfaces in the surface enum", async () => {
    const { rows } = await h
      .client()
      .query<{ v: string }>(
        "select unnest(enum_range(null::surface))::text as v",
      );
    expect(rows.map((r) => r.v)).toEqual(schema.surface.enumValues);
    expect(schema.surface.enumValues).toEqual([
      "ui",
      "kiosk",
      "ai",
      "mcp",
      "brain",
    ]);
    const m = await aMember();
    await expect(
      h.db().execute(sql`
        insert into audit_events (actor_member_id, source, action, entity)
        values (${m.id}, 'cron', 'a', 'e')`),
    ).rejects.toThrow();
  });

  it("refuses two members with the same telegram id or auth user", async () => {
    await h
      .db()
      .insert(schema.members)
      .values({ ...member, telegramUserId: 42, authUserId: "u1" });
    await expect(
      h
        .db()
        .insert(schema.members)
        .values({ ...member, telegramUserId: 42 }),
    ).rejects.toThrow();
    await expect(
      h
        .db()
        .insert(schema.members)
        .values({ ...member, authUserId: "u1" }),
    ).rejects.toThrow();
    // Both are nullable: any number of members may have neither.
    await h.db().insert(schema.members).values([member, member]);
    expect(await h.db().select().from(schema.members)).toHaveLength(3);
  });
});
