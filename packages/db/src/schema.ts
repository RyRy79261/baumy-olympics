// THE ONLY SOURCE OF TRUTH for the database (AGENTS.md "Database rules").
// Migrations under ../migrations are generated from this file with
// `pnpm --filter @baumy/db db:generate` and are never edited by hand. CI fails
// when this file and the migrations disagree.
//
// SPEC §5 is the design. All ids are uuid with defaultRandom() unless noted,
// and every time is a timestamptz.

import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Where a request came from (SPEC §6.3). Every `source` column uses this one
 * pg enum. The Zod mirror (`Surface` in packages/types) arrives with the action
 * registry and must list the same values in the same order.
 */
export const surface = pgEnum("surface", ["ui", "kiosk", "ai", "mcp", "brain"]);

export const memberRole = pgEnum("member_role", ["admin", "member"]);

export const actionRequestStatus = pgEnum("action_request_status", [
  "pending",
  "done",
  "failed",
]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * There is exactly one household. It is seeded by migration 0001 with the
 * fixed id in `household.ts`, so every environment agrees on it.
 */
export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tz: text("tz").notNull().default("Europe/Berlin"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A person in the household. `auth_user_id` is the Better Auth `user.id`, with
 * no foreign key, as camp-404 does: the auth tables are owned by Better Auth
 * and arrive in a later issue. Kiosk-only members have no auth user.
 */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    authUserId: text("auth_user_id").unique(),
    displayName: text("display_name").notNull(),
    avatarSprite: text("avatar_sprite").notNull(),
    color: text("color").notNull(),
    role: memberRole("role").notNull().default("member"),
    /** scrypt hash, never the PIN itself. */
    kioskPinHash: text("kiosk_pin_hash"),
    kioskPinLockedAt: timestamp("kiosk_pin_locked_at", { withTimezone: true }),
    /** Telegram user ids fit in 52 bits, so a JS number holds them exactly. */
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).unique(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("members_household_id_idx").on(t.householdId)],
);

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/**
 * The idempotency ledger for every write action (SPEC §5, §6.3). Owned by
 * `runAction`, which claims a row before running the action and stores the
 * result in the same transaction. A retry with the same key and the same
 * `input_hash` gets the stored result; the same key with a different input is
 * refused.
 */
export const actionRequests = pgTable(
  "action_requests",
  {
    actorMemberId: uuid("actor_member_id")
      .notNull()
      .references(() => members.id),
    source: surface("source").notNull(),
    requestId: text("request_id").notNull(),
    action: text("action").notNull(),
    inputHash: text("input_hash").notNull(),
    status: actionRequestStatus("status").notNull().default("pending"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.actorMemberId, t.source, t.requestId] })],
);

/**
 * Who did what, through which surface. Owned by `runAction` and written in the
 * SAME transaction as the change it records. `entity_id` is text because
 * entities are keyed by uuid, bigserial or a natural key.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorMemberId: uuid("actor_member_id")
      .notNull()
      .references(() => members.id),
    source: surface("source").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    payload: jsonb("payload"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_at_idx").on(t.at),
    index("audit_events_entity_idx").on(t.entity, t.entityId),
  ],
);

/**
 * Fixed-window counters for our own rate limits (rate-limit.ts), copied from
 * camp-404 `packages/db/src/schema.ts`. Kiosk PIN attempts live here too
 * (SPEC §5, keys `pin:<device>:<member>` and `pin24:<member>`).
 *
 * NOT Better Auth's `rate_limit` table: Better Auth sweeps that one wholesale,
 * so nothing of ours may live there. `window_start` is epoch milliseconds, so
 * the limiter does its arithmetic in plain numbers. Rows are swept by the
 * limiter itself; a key can hold a member id or a device id, so rows live at
 * most a week.
 */
export const actionRateLimit = pgTable(
  "action_rate_limit",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
  },
  (t) => [index("action_rate_limit_window_start_idx").on(t.windowStart)],
);
