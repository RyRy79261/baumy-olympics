// THE ONLY SOURCE OF TRUTH for the database (AGENTS.md "Database rules").
// Migrations under ../migrations are generated from this file with
// `pnpm --filter @baumy/db db:generate` and are never edited by hand. CI fails
// when this file and the migrations disagree.
//
// SPEC §5 is the design. All ids are uuid with defaultRandom() unless noted,
// and every time is a timestamptz.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
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
 * pg enum. The Zod mirror is `Surface` in packages/types, which must list the
 * same values in the same order (a test in apps/web/lib/actions compares them).
 */
export const surface = pgEnum("surface", ["ui", "kiosk", "ai", "mcp", "brain"]);

export const memberRole = pgEnum("member_role", ["admin", "member"]);

export const actionRequestStatus = pgEnum("action_request_status", [
  "pending",
  "done",
  "failed",
]);

// ---------------------------------------------------------------------------
// Better Auth (ADR 0001, SPEC §5)
// ---------------------------------------------------------------------------
//
// Copied from camp-404 `packages/db/src/schema.ts` (the Better Auth block),
// without `two_factor` and `passkey`, which v1 leaves out (SPEC §11). Better
// Auth 1.6.25 owns these tables through its drizzle adapter
// (packages/auth/src/config.ts). The JS keys are Better Auth's field names,
// which the adapter reads; the columns are snake_case like the rest of this
// file.
//
// Two identities, by design: `user` is the sign-in identity (email, password
// hash through `account`, sessions), `members` is the person in the household.
// `members.auth_user_id` holds `user.id` with no foreign key (camp-404 does the
// same), so an account can be erased without touching household history.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * One row per signed-in device. `token` is stored IN PLAINTEXT by Better Auth
 * 1.6.25 (SPEC §7): whoever can read this table can take over a session, so
 * treat database credentials accordingly. Cookies and bearer tokens carry the
 * token plus an HMAC signature, and the bearer plugin is configured to require
 * that signature (packages/auth/src/config.ts).
 */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

/** A way to sign in: `credential` (the password hash) or `google`. */
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    /** The password hash, on the `credential` account. Never read by the app. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

/** Password-reset and email-verification tokens. */
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * Better Auth's rate-limit counters, in the database so every serverless
 * instance shares them. BETTER AUTH OWNS THIS TABLE OUTRIGHT, including
 * sweeping rows from it: nothing of ours may live here. Our own counters are
 * `action_rate_limit` below.
 */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

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
 * no foreign key, as camp-404 does: the auth tables above are owned by Better
 * Auth. Kiosk-only members have no auth user.
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

/**
 * The front door (SPEC §6.2): a signed-in account with no `members` row
 * redeems one of these at `/join`. `code` is stored lowercased, and every
 * lookup lowercases what was typed (invite-codes.ts). A redeem claims a use
 * with ONE `UPDATE … WHERE use_count < max_uses … RETURNING`, ported from
 * camp-404 `packages/db/src/invite-codes.ts`, so two people racing for the
 * last use cannot both get it; the check constraint is the backstop.
 */
export const inviteCodes = pgTable(
  "invite_codes",
  {
    code: text("code").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    /** The role the new member gets. */
    role: memberRole("role").notNull().default("member"),
    maxUses: integer("max_uses").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => members.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("invite_codes_max_uses_positive", sql`${t.maxUses} >= 1`),
    check(
      "invite_codes_use_count_in_range",
      sql`${t.useCount} >= 0 AND ${t.useCount} <= ${t.maxUses}`,
    ),
  ],
);

/**
 * One-time codes a member creates in `/settings` and sends to baumy-brain as
 * `/link <code>` (SPEC §6.6). Only the sha256 of the code is stored, so a
 * database read does not yield a working code. Single use, 10 minutes; the
 * redeem (`link_telegram`, issue #27) claims it with `UPDATE … WHERE used_at
 * IS NULL AND expires_at > now … RETURNING`.
 */
export const telegramLinkCodes = pgTable(
  "telegram_link_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** The Telegram user id that redeemed it. */
    usedByTg: bigint("used_by_tg", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("telegram_link_codes_member_id_idx").on(t.memberId)],
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
