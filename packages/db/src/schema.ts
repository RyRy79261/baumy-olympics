// THE ONLY SOURCE OF TRUTH for the database (AGENTS.md "Database rules").
// Migrations under ../migrations are generated from this file with
// `pnpm --filter @baumy/db db:generate` and are never edited by hand. CI fails
// when this file and the migrations disagree.
//
// SPEC §5 is the design. All ids are uuid with defaultRandom() unless noted,
// and every time is a timestamptz.

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

// The game enums mirror the unions in packages/core/src/scoring (ruleset.ts,
// validate.ts, verification.ts, standings.ts); a test in packages/db compares
// them.

export const proofMode = pgEnum("proof_mode", ["none", "optional", "required"]);

/**
 * What kind of bounty a chore is (ADR 0005): buy or refill, or clean or fix.
 * Mirrors `ChoreKind` in packages/types (a test in packages/db compares them).
 */
export const choreKind = pgEnum("chore_kind", ["consumable", "maintenance"]);

export const confirmMode = pgEnum("confirm_mode", ["optimistic", "partner"]);

export const ruleSource = pgEnum("rule_source", [
  "seed",
  "manual",
  "suggestion",
]);

export const weightSuggestionStatus = pgEnum("weight_suggestion_status", [
  "open",
  "scheduled",
  "dismissed",
  "vetoed",
  "applied",
  "superseded",
]);

/**
 * Where a weight change came from (SPEC §4.4): the weekly `measured`
 * suggestion, or an `admin` who set the points by hand (issue #115). An
 * admin's change skips the measurement and the 28-day spacing, but not the
 * 48h veto window.
 */
export const weightChangeOrigin = pgEnum("weight_change_origin", [
  "measured",
  "admin",
]);

/** v1 implements `points` only (SPEC §4.5); the others are kept for later. */
export const prizeMode = pgEnum("prize_mode", [
  "points",
  "heaviest_streak",
  "longest_streak",
]);

export const seasonStatus = pgEnum("season_status", [
  "active",
  "closing",
  "closed",
]);

export const completionStatus = pgEnum("completion_status", [
  "pending",
  "confirmed",
  "finalized",
  "disputed",
  "voided",
]);

export const voidReason = pgEnum("void_reason", [
  "unconfirmed",
  "conceded",
  "disputed",
  "undone",
]);

export const disputeResolution = pgEnum("dispute_resolution", [
  "withdrawn",
  "conceded",
  "undone",
  "upheld",
  "overruled",
  "expired",
]);

/** Who an `ai_usage` row paid (SPEC §5): Claude for commands, Groq for speech. */
export const aiProvider = pgEnum("ai_provider", ["anthropic", "groq"]);

// ---------------------------------------------------------------------------
// Better Auth (ADR 0001, SPEC §5)
// ---------------------------------------------------------------------------
//
// Copied from camp-404 `packages/db/src/schema.ts` (the Better Auth block).
// `two_factor`, `passkey` and `user.two_factor_enabled` came with the
// twoFactor and @better-auth/passkey plugins (issue #79). Better
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
  // Added by the twoFactor plugin (issue #79): true once a TOTP enrolment is
  // verified, which is what makes a password sign-in ask for the code. The
  // secret and the backup codes live in `two_factor`, never on this row.
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
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

/**
 * The twoFactor plugin's per-user TOTP secret and backup codes, both
 * ENCRYPTED with BETTER_AUTH_SECRET (the plugin encrypts the secret, and
 * @baumy/auth sets `storeBackupCodes: "encrypted"`). One row per user who has
 * started enrolment; `user.twoFactorEnabled` is the "actually on" flag.
 * Copied from camp-404 `packages/db/src/schema.ts` (issue #79).
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count")
      .notNull()
      .default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    index("two_factor_user_id_idx").on(t.userId),
    index("two_factor_secret_idx").on(t.secret),
  ],
);

/**
 * One row per registered passkey (@better-auth/passkey, issue #79). A passkey
 * is bound for life to the relying-party id it was made under
 * (`resolvePasskeyRpID` in @baumy/auth). `counter` is the WebAuthn signature
 * counter; `public_key` is public by definition, so nothing here is a secret.
 */
export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    aaguid: text("aaguid"),
  },
  (t) => [
    index("passkey_user_id_idx").on(t.userId),
    index("passkey_credential_id_idx").on(t.credentialID),
  ],
);

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
    /**
     * UNUSED since issue #116 (owner ruling 2026-09-29, "Burn it"): it held
     * the drawn character's hair, skin and shirt ids, and nothing reads or
     * writes it now. Kept, not dropped, so no migration touches member data;
     * a later cleanup may drop it.
     */
    avatar: jsonb("avatar"),
    /**
     * The gallery sprite they picked (issue #111), or null: then their
     * initial in their `color` is shown instead. Two members may pick the
     * same one. Archiving a sprite hides it from the gallery but keeps it on
     * whoever already wears it, so nothing ever deletes the row this points
     * at.
     */
    avatarImageId: uuid("avatar_image_id").references(
      (): AnyPgColumn => avatars.id,
    ),
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
 * The gallery of pre-generated pixel characters (issue #111), one row per
 * character SET (its poses are `avatar_poses`). The owner makes each one
 * elsewhere and uploads it at /admin/avatars; the app only cleans it (apps/web
 * lib/avatars/clean.ts) and stores the poses in the PRIVATE Blob store,
 * served only through /api/blob. Archived ones leave the gallery but stay on
 * whoever already picked them; rows are never deleted.
 */
export const avatars = pgTable(
  "avatars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references((): AnyPgColumn => members.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("avatars_household_id_idx").on(t.householdId)],
);

/**
 * The poses of one gallery character (owner ruling 2026-09-29): `idle`
 * (standing, three-quarter; every set has it), `walk` and `emote`. All the
 * poses of a set were cleaned together at one scale and on one palette.
 * `pathname` is `avatars/{avatarId}/{rand}.png`; `width` and `height` are
 * the sprite's own pixels.
 */
export const avatarPose = pgEnum("avatar_pose", ["idle", "walk", "emote"]);

export const avatarPoses = pgTable(
  "avatar_poses",
  {
    avatarId: uuid("avatar_id")
      .notNull()
      .references(() => avatars.id),
    pose: avatarPose("pose").notNull(),
    pathname: text("pathname").notNull().unique(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.avatarId, t.pose] }),
    check(
      "avatar_poses_size_positive",
      sql`${t.width} > 0 AND ${t.height} > 0`,
    ),
  ],
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

/**
 * Where a "Sign in with Baumy" request stands (issue #80). `expired` is not
 * stored: a `pending` or `approved` row past its time reads as expired
 * (`loginRequestState`, login-requests.ts).
 */
export const loginRequestStatus = pgEnum("login_request_status", [
  "pending",
  "approved",
  "denied",
  "used",
]);

/**
 * "Sign in with Baumy" (issue #80, ADR 0006): a browser asks to sign in as an
 * address; brain DMs the member's linked Telegram account "Tap the number on
 * the screen", and the tap approves or denies it through `approve_login` /
 * `deny_login`. The waiting browser holds the only copy of a random secret
 * (an httpOnly cookie) and exchanges it once for a Better Auth session.
 *
 * - `member_id` is null when the address cannot sign in this way (no account,
 *   no member, no Telegram link, locked): the row is still written and the
 *   browser sees the same screen, so the answer never says which.
 * - Only the sha256 of the secret is stored.
 * - `code` is the number on the screen; `choices` is it plus four decoys,
 *   in the order the Telegram buttons show them.
 * - pending → approved → used, or pending → denied (`deny_reason`: `denied`
 *   when the member tapped Deny, `wrong_code` when they tapped a decoy).
 *   Either denial locks the method for that member for 15 minutes. Each step
 *   is a compare-and-set on the status.
 */
export const loginRequests = pgTable(
  "login_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id),
    secretHash: text("secret_hash").notNull().unique(),
    code: integer("code").notNull(),
    choices: integer("choices").array().notNull(),
    /** A short summary of the browser that asked ("Chrome on macOS"). */
    device: text("device").notNull(),
    status: loginRequestStatus("status").notNull().default("pending"),
    denyReason: text("deny_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("login_requests_member_id_idx").on(t.memberId, t.decidedAt),
    index("login_requests_created_at_idx").on(t.createdAt),
    check("login_requests_code_two_digits", sql`${t.code} BETWEEN 10 AND 99`),
  ],
);

/**
 * A kitchen kiosk (SPEC §5, §6.2, §8): an iPad that stays signed in as a
 * DEVICE, not a person. Since issue #126 the iPad asks to be paired
 * (`kiosk_pairing_requests`, below) and an admin approves it by scanning its
 * QR code (`approve_kiosk_pairing`), which creates this row, unpaired, until
 * `pairing_expires_at`. The iPad's next poll trades its request for a device
 * token with ONE `UPDATE … WHERE paired_at IS NULL … RETURNING`
 * (kiosk-pairing.ts), which stores the sha256 of the random token its
 * `baumy_kiosk` cookie carries. The token is never stored. `revoke_kiosk`
 * sets `revoked_at`, which signs the device out (or cancels an approval the
 * iPad has not picked up).
 *
 * `token_hash` is nullable and unique: Postgres lets many rows hold NULL in a
 * unique column, which is exactly "not paired yet". `pairing_code_hash` held
 * the admin-made 8-character code of the flow before issue #126; nothing
 * writes it any more (drop it in a later migration, once no deployment of the
 * old code is left).
 */
export const kioskDevices = pgTable(
  "kiosk_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    /** sha256 hex of the device token; set when the device pairs. */
    tokenHash: text("token_hash").unique(),
    /** Unused since issue #126 (the old admin-made code); always null. */
    pairingCodeHash: text("pairing_code_hash").unique(),
    pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
    /** The admin who approved the pairing. */
    pairedBy: uuid("paired_by")
      .notNull()
      .references(() => members.id),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("kiosk_devices_household_id_idx").on(t.householdId),
    // A device is paired exactly when it has a token.
    check(
      "kiosk_devices_paired_has_token",
      sql`(${t.pairedAt} IS NULL) = (${t.tokenHash} IS NULL)`,
    ),
  ],
);

/**
 * Where a kiosk pairing request stands (issue #126). `expired` is derived,
 * never stored: a `pending` or `approved` row past its time reads as expired
 * (`kioskPairingState`, kiosk-pairing.ts).
 */
export const kioskPairingStatus = pgEnum("kiosk_pairing_status", [
  "pending",
  "approved",
  "used",
]);

/**
 * An iPad asking to become the kitchen screen (issue #126, SPEC §6.2). The
 * unpaired iPad at `/kiosk/pair` starts one (a sign-in, not an action: nobody
 * is signed in) and shows its short code as a QR code. An admin scans it on
 * their phone and approves it (`approve_kiosk_pairing`), which creates the
 * `kiosk_devices` row; the iPad, polling, trades the request for its device
 * token once.
 *
 * - Only hashes are stored: the sha256 of the iPad's 32-byte secret (in its
 *   httpOnly cookie, never in a URL) and of the short code the QR carries.
 * - pending → approved → used, each step a compare-and-set on the status.
 *   10 minutes to approve; the exchange gets a short grace after that.
 * - `device` is a short label for the browser that asked ("Safari on iPad"),
 *   shown to the admin who approves it.
 */
export const kioskPairingRequests = pgTable(
  "kiosk_pairing_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    secretHash: text("secret_hash").notNull().unique(),
    codeHash: text("code_hash").notNull().unique(),
    device: text("device").notNull(),
    /**
     * The network the request came from, as a prefix only ("203.0.113.0/24",
     * "2001:db8:1::/48"), never the full address: the confirm page warns an
     * admin approving from a different network (a phished link). Null when
     * the address was unknown.
     */
    requesterNetwork: text("requester_network"),
    status: kioskPairingStatus("status").notNull().default("pending"),
    /** The device row the approval created. */
    deviceId: uuid("device_id").references(() => kioskDevices.id),
    approvedBy: uuid("approved_by").references(() => members.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("kiosk_pairing_requests_created_at_idx").on(t.createdAt),
    // Approved (or used) exactly when there is a device for it.
    check(
      "kiosk_pairing_requests_approved_has_device",
      sql`(${t.status} = 'pending') = (${t.deviceId} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Game (SPEC §4, §5)
// ---------------------------------------------------------------------------
//
// `completion_scores` is output, never input: `rescoreChore` (completions.ts)
// rebuilds a (chore, season) from the completions and rule versions on every
// write to that chore, so the table can be dropped and rebuilt identically.

/** A household chore. Its weight lives in `chore_rule_versions`. */
export const chores = pgTable(
  "chores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    sprite: text("sprite").notNull(),
    kind: choreKind("kind").notNull().default("maintenance"),
    proofMode: proofMode("proof_mode").notNull().default("none"),
    confirmMode: confirmMode("confirm_mode").notNull().default("optimistic"),
    effortFactorPct: integer("effort_factor_pct").notNull().default(100),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("chores_household_id_idx").on(t.householdId),
    check(
      "chores_effort_factor_pct_range",
      sql`${t.effortFactorPct} BETWEEN 50 AND 300`,
    ),
  ],
);

/**
 * A chore's weight from `effective_from` on. Changes insert a new row and are
 * never retroactive (SPEC §4.4): a completion is scored by the version in
 * effect when it happened (`ruleVersionAt` in packages/core).
 *
 * `suggestion_id` names the `weight_suggestions` row a `suggestion` version
 * came from; each suggestion applies at most once (the unique index).
 * `created_by` is null for `seed` rows.
 */
export const choreRuleVersions = pgTable(
  "chore_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    choreId: uuid("chore_id")
      .notNull()
      .references(() => chores.id),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    basePoints: integer("base_points").notNull(),
    cooldownMinutes: integer("cooldown_minutes").notNull(),
    source: ruleSource("source").notNull(),
    suggestionId: uuid("suggestion_id").references(
      (): AnyPgColumn => weightSuggestions.id,
    ),
    createdBy: uuid("created_by").references(() => members.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("chore_rule_versions_chore_effective_from_uq").on(
      t.choreId,
      t.effectiveFrom,
    ),
    // Many NULLs pass a unique index, which is what `seed`/`manual` rows need.
    uniqueIndex("chore_rule_versions_suggestion_id_uq").on(t.suggestionId),
    check(
      "chore_rule_versions_base_points_range",
      sql`${t.basePoints} BETWEEN 1 AND 200`,
    ),
    check(
      "chore_rule_versions_cooldown_non_negative",
      sql`${t.cooldownMinutes} >= 0`,
    ),
    check(
      "chore_rule_versions_suggestion_source",
      sql`(${t.suggestionId} IS NULL) OR (${t.source} = 'suggestion')`,
    ),
  ],
);

/**
 * A weekly measurement of how often a chore is done, and the weight change it
 * suggests (SPEC §4.4). Only a measurement outside the dead-band is stored.
 * `computeSuggestions` (weights.ts) writes at most one per chore and Berlin
 * week (`week_start`); an admin schedules or dismisses it, another member may
 * veto a scheduled one until `applies_at`, and `applyDueSuggestions` turns it
 * into a `suggestion` rule version effective from the moment it runs.
 *
 * `sample_intervals` are the winsorised gaps in minutes, oldest first (the
 * panel's sparkline). `scheduled_points`/`scheduled_cooldown_minutes` are what
 * the admin scheduled ("Edit & schedule" may differ from the suggestion).
 *
 * An `admin` row (issue #115) is a change an admin made by hand, any day: it
 * has no measurement, is `scheduled` from the start (with its optional
 * `reason`), lands the same way and can be vetoed or cancelled the same way.
 * These rows and `chore_rule_versions` are the points history.
 */
export const weightSuggestions = pgTable(
  "weight_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    choreId: uuid("chore_id")
      .notNull()
      .references(() => chores.id),
    origin: weightChangeOrigin("origin").notNull().default("measured"),
    weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    // The measurement: set on every `measured` row, null on an `admin` one.
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    sampleIntervals: integer("sample_intervals").array(),
    medianIntervalMinutes: integer("median_interval_minutes"),
    rawPoints: doublePrecision("raw_points"),
    currentPoints: integer("current_points").notNull(),
    currentCooldownMinutes: integer("current_cooldown_minutes").notNull(),
    suggestedPoints: integer("suggested_points"),
    suggestedCooldownMinutes: integer("suggested_cooldown_minutes"),
    /** Why an admin set these points (issue #115); optional. */
    reason: text("reason"),
    status: weightSuggestionStatus("status").notNull().default("open"),
    scheduledPoints: integer("scheduled_points"),
    scheduledCooldownMinutes: integer("scheduled_cooldown_minutes"),
    appliesAt: timestamp("applies_at", { withTimezone: true }),
    scheduledBy: uuid("scheduled_by").references(() => members.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    dismissedBy: uuid("dismissed_by").references(() => members.id),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    vetoedBy: uuid("vetoed_by").references(() => members.id),
    vetoedAt: timestamp("vetoed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [
    // One measured suggestion per chore and Berlin week; an admin's change
    // has a week too, but may come any day.
    uniqueIndex("weight_suggestions_chore_week_uq")
      .on(t.choreId, t.weekStart)
      .where(sql`${t.origin} = 'measured'`),
    // One suggestion per chore is waiting on people at a time.
    uniqueIndex("weight_suggestions_one_active_per_chore_uq")
      .on(t.choreId)
      .where(sql`${t.status} IN ('open', 'scheduled')`),
    index("weight_suggestions_scheduled_idx")
      .on(t.appliesAt)
      .where(sql`${t.status} = 'scheduled'`),
    check(
      "weight_suggestions_suggested_points_range",
      sql`${t.suggestedPoints} BETWEEN 5 AND 60`,
    ),
    check(
      "weight_suggestions_scheduled_points_range",
      sql`${t.scheduledPoints} BETWEEN 1 AND 200`,
    ),
    check(
      "weight_suggestions_cooldowns_non_negative",
      sql`${t.suggestedCooldownMinutes} >= 0 AND ${t.scheduledCooldownMinutes} >= 0`,
    ),
    // Scheduled, vetoed and applied ones were scheduled first; open ones not.
    check(
      "weight_suggestions_scheduled_has_schedule",
      sql`${t.status} NOT IN ('scheduled', 'vetoed', 'applied') OR (${t.appliesAt} IS NOT NULL AND ${t.scheduledBy} IS NOT NULL AND ${t.scheduledAt} IS NOT NULL AND ${t.scheduledPoints} IS NOT NULL AND ${t.scheduledCooldownMinutes} IS NOT NULL)`,
    ),
    check(
      "weight_suggestions_open_unscheduled",
      sql`${t.status} <> 'open' OR ${t.appliesAt} IS NULL`,
    ),
    check(
      "weight_suggestions_measured_has_measurement",
      sql`${t.origin} <> 'measured' OR (${t.windowStart} IS NOT NULL AND ${t.windowEnd} IS NOT NULL AND ${t.sampleIntervals} IS NOT NULL AND ${t.medianIntervalMinutes} IS NOT NULL AND ${t.rawPoints} IS NOT NULL AND ${t.suggestedPoints} IS NOT NULL AND ${t.suggestedCooldownMinutes} IS NOT NULL)`,
    ),
    // An admin's change is scheduled as it is made, so it is never open.
    check(
      "weight_suggestions_admin_scheduled",
      sql`${t.origin} <> 'admin' OR (${t.status} <> 'open' AND ${t.scheduledAt} IS NOT NULL)`,
    ),
    check(
      "weight_suggestions_reason_length",
      sql`${t.reason} IS NULL OR char_length(${t.reason}) BETWEEN 1 AND 280`,
    ),
    check(
      "weight_suggestions_dismissed",
      sql`(${t.status} = 'dismissed') = (${t.dismissedBy} IS NOT NULL AND ${t.dismissedAt} IS NOT NULL)`,
    ),
    check(
      "weight_suggestions_vetoed",
      sql`(${t.status} = 'vetoed') = (${t.vetoedBy} IS NOT NULL AND ${t.vetoedAt} IS NOT NULL)`,
    ),
    check(
      "weight_suggestions_applied",
      sql`(${t.status} = 'applied') = (${t.appliedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * A calendar year in Berlin (SPEC §4.1), stored as UTC instants:
 * `[starts_at, ends_at)`. Created lazily by `ensureSeason` (seasons.ts).
 */
export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    year: integer("year").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    prizeMode: prizeMode("prize_mode").notNull().default("points"),
    status: seasonStatus("status").notNull().default("active"),
    winnerMemberId: uuid("winner_member_id").references(() => members.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("seasons_household_year_uq").on(t.householdId, t.year),
    check("seasons_ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    // Only a closed season has a winner (and there may be none: a tie).
    check(
      "seasons_winner_only_when_closed",
      sql`${t.winnerMemberId} IS NULL OR ${t.status} = 'closed'`,
    ),
  ],
);

/**
 * One claim that a member did a chore (SPEC §4.3). Written only by
 * `logCompletion`, and its status only by `setCompletionStatus`, both of
 * which lock the chore row first.
 *
 * `client_request_id` is NOT NULL on purpose: a nullable column in a unique
 * index lets any number of NULLs through (AGENTS.md "Postgres traps").
 */
export const completions = pgTable(
  "completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    choreId: uuid("chore_id")
      .notNull()
      .references(() => chores.id),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    doneBy: uuid("done_by")
      .notNull()
      .references(() => members.id),
    loggedBy: uuid("logged_by")
      .notNull()
      .references(() => members.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
    source: surface("source").notNull(),
    status: completionStatus("status").notNull(),
    verifiedBy: uuid("verified_by").references(() => members.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    finalizesAt: timestamp("finalizes_at", { withTimezone: true }),
    photoPathname: text("photo_pathname"),
    photoAttachedAt: timestamp("photo_attached_at", { withTimezone: true }),
    note: text("note"),
    voidReason: voidReason("void_reason"),
    clientRequestId: text("client_request_id").notNull(),
  },
  (t) => [
    uniqueIndex("completions_household_client_request_uq").on(
      t.householdId,
      t.clientRequestId,
    ),
    index("completions_chore_season_occurred_idx").on(
      t.choreId,
      t.seasonId,
      t.occurredAt,
    ),
    index("completions_season_idx").on(t.seasonId),
    // A voided row says why, and only a voided row has a reason.
    check(
      "completions_void_reason_iff_voided",
      sql`(${t.status} = 'voided') = (${t.voidReason} IS NOT NULL)`,
    ),
    check(
      "completions_verified_pair",
      sql`(${t.verifiedBy} IS NULL) = (${t.verifiedAt} IS NULL)`,
    ),
    check(
      "completions_confirmed_is_verified",
      sql`${t.status} <> 'confirmed' OR ${t.verifiedBy} IS NOT NULL`,
    ),
    // A photo keeps its attach time; the time outlives a pruned photo.
    check(
      "completions_photo_has_time",
      sql`${t.photoPathname} IS NULL OR ${t.photoAttachedAt} IS NOT NULL`,
    ),
  ],
);

/**
 * The replay's output for each counted completion (SPEC §4.2). Always
 * rebuildable; never edit a row by hand, re-score the chore instead.
 */
export const completionScores = pgTable(
  "completion_scores",
  {
    completionId: uuid("completion_id")
      .primaryKey()
      .references(() => completions.id, { onDelete: "cascade" }),
    ruleVersionId: uuid("rule_version_id")
      .notNull()
      .references(() => choreRuleVersions.id),
    rulesetVersion: integer("ruleset_version").notNull(),
    streakLen: integer("streak_len").notNull(),
    multiplierPct: integer("multiplier_pct").notNull(),
    basePts: integer("base_pts").notNull(),
    streakPts: integer("streak_pts").notNull(),
    brokenMemberId: uuid("broken_member_id").references(() => members.id),
    brokenLen: integer("broken_len"),
    breakPts: integer("break_pts").notNull(),
    totalPts: integer("total_pts").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("completion_scores_streak_len_positive", sql`${t.streakLen} >= 1`),
    check(
      "completion_scores_total",
      sql`${t.totalPts} = ${t.streakPts} + ${t.breakPts}`,
    ),
    check(
      "completion_scores_broken_pair",
      sql`(${t.brokenMemberId} IS NULL) = (${t.brokenLen} IS NULL)`,
    ),
  ],
);

/**
 * A challenge to a completion (SPEC §4.3). At most one is open per
 * completion (the partial unique index); an open one has no resolution.
 */
export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    completionId: uuid("completion_id")
      .notNull()
      .references(() => completions.id),
    raisedBy: uuid("raised_by")
      .notNull()
      .references(() => members.id),
    reason: text("reason").notNull(),
    resolution: disputeResolution("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("disputes_one_open_per_completion_uq")
      .on(t.completionId)
      .where(sql`${t.resolvedAt} IS NULL`),
    index("disputes_completion_id_idx").on(t.completionId),
    check("disputes_reason_not_blank", sql`btrim(${t.reason}) <> ''`),
    check(
      "disputes_resolution_pair",
      sql`(${t.resolution} IS NULL) = (${t.resolvedAt} IS NULL)`,
    ),
  ],
);

/**
 * A manual change to a member's season total (SPEC §4.5). It counts once
 * approved, by someone other than its creator. May be negative, never zero.
 */
export const pointAdjustments = pgTable(
  "point_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => members.id),
    approvedBy: uuid("approved_by").references(() => members.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("point_adjustments_season_id_idx").on(t.seasonId),
    check("point_adjustments_points_nonzero", sql`${t.points} <> 0`),
    check(
      "point_adjustments_approver_not_creator",
      sql`${t.approvedBy} <> ${t.createdBy}`,
    ),
    check(
      "point_adjustments_approved_pair",
      sql`(${t.approvedBy} IS NULL) = (${t.approvedAt} IS NULL)`,
    ),
  ],
);

/** Money into the year-end pot (SPEC §4.5). `month` is the 1st of a month. */
export const potContributions = pgTable(
  "pot_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    month: date("month", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    contributedBy: uuid("contributed_by")
      .notNull()
      .references(() => members.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pot_contributions_season_id_idx").on(t.seasonId),
    check("pot_contributions_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "pot_contributions_month_first_day",
      sql`extract(day from ${t.month}) = 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

/**
 * Short household notes (SPEC §3.5): "plumber comes Tue", the guest wifi.
 * Never secrets. `body_md` is markdown and is only ever shown through the
 * sanitising renderer (packages/ui `MarkdownBody`). `color` is a name from
 * `NOTE_COLORS` (packages/types), or null for a plain note. `delete_note` is
 * a soft delete: it sets `deleted_at`, and every read leaves those rows out.
 * `edited_at` is when its words last changed (added or edited, not pinned):
 * the kitchen screen's Messages count (ADR 0005 §3). Null on notes from
 * before it existed, which count from `created_at`.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    color: text("color"),
    pinned: boolean("pinned").notNull().default(false),
    authorId: uuid("author_id")
      .notNull()
      .references(() => members.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("notes_household_live_idx")
      .on(t.householdId, t.pinned, t.updatedAt)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

/**
 * A reminder for everyone (ADR 0005 §4): "Handyman on Wednesday". The
 * kitchen screen shows it full-screen until every active member has
 * acknowledged it (`reminder_acks`), or a member dismisses it for everyone
 * (`dismissed_at`, `dismissed_by`, set together or not at all). The ack
 * that leaves nobody waiting sets `completed_at` in the same transaction,
 * so a reminder everyone has seen stays closed when someone joins later.
 * `body` is plain text.
 */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => members.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: uuid("dismissed_by").references(() => members.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("reminders_household_open_idx")
      .on(t.householdId, t.createdAt)
      .where(sql`${t.dismissedAt} IS NULL AND ${t.completedAt} IS NULL`),
    check(
      "reminders_dismissed_together",
      sql`(${t.dismissedAt} IS NULL) = (${t.dismissedBy} IS NULL)`,
    ),
  ],
);

/** "I read this": one row per member and reminder (the primary key). */
export const reminderAcks = pgTable(
  "reminder_acks",
  {
    reminderId: uuid("reminder_id")
      .notNull()
      .references(() => reminders.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    ackedAt: timestamp("acked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reminderId, t.memberId] })],
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
 *
 * `initiated_by_member_id` is set only when someone else asked for the change
 * on the actor's behalf: brain's `X-Baumy-On-Behalf-Of` (issue #70), where
 * `actor_member_id` is the housemate it was done for and this column is the
 * linked Telegram member who asked. Null when the actor did it themself.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /**
     * Null only when nobody is signed in to be the actor: "Sign in with
     * Baumy" asked for a member's approval (`request_login`, issue #80), where
     * the member is the target (`entity` member) and the requester is
     * anonymous (its IP and device are in `payload`).
     */
    actorMemberId: uuid("actor_member_id").references(() => members.id),
    initiatedByMemberId: uuid("initiated_by_member_id").references(
      () => members.id,
    ),
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

/**
 * What the AI features cost, per member (SPEC §5, §6.3). One `anthropic` row
 * per Baumy command, with the tokens of every Claude call in its tool loop
 * summed: the row is claimed before the first call (`claimAiCommand` in
 * ai-usage.ts, which also enforces the daily limit) and its tokens are added
 * when the loop ends. Groq rows (speech, issue #22) carry `audio_seconds`.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    provider: aiProvider("provider").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    audioSeconds: doublePrecision("audio_seconds"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_member_at_idx").on(t.memberId, t.provider, t.at),
    check(
      "ai_usage_tokens_non_negative",
      sql`${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// MCP OAuth (SPEC §6.3, issue #23)
// ---------------------------------------------------------------------------
//
// The authorization server that lets a chatbot (claude.ai's custom connector,
// Claude Desktop, Claude Code) act as ONE member. Ported from intake-tracker
// `apps/web/src/db/schema.ts` (mcp_oauth_clients, mcp_auth_codes,
// mcp_access_tokens), keyed on `members` instead of Neon Auth users.
//
// Nothing secret is stored: client secrets, codes, access and refresh tokens
// are kept as sha256 hex only (mcp-oauth.ts). Rows are never deleted by the
// app; a revoked or expired row simply stops working.

/** A client registered through Dynamic Client Registration (RFC 7591). */
export const mcpOauthClients = pgTable(
  "mcp_oauth_clients",
  {
    clientId: text("client_id").primaryKey(),
    /** sha256 hex; null for a public client (`none`). */
    clientSecretHash: text("client_secret_hash"),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris").array().notNull(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "mcp_oauth_clients_auth_method",
      sql`${t.tokenEndpointAuthMethod} IN ('none', 'client_secret_basic', 'client_secret_post')`,
    ),
    check(
      "mcp_oauth_clients_secret_matches_method",
      sql`(${t.clientSecretHash} IS NULL) = (${t.tokenEndpointAuthMethod} = 'none')`,
    ),
  ],
);

/**
 * A single-use authorization code, minted when a member approves the consent
 * screen. PKCE is S256 only. `scopes` are the ones the member ticked.
 */
export const mcpAuthCodes = pgTable(
  "mcp_auth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("mcp_auth_codes_member_id_idx").on(t.memberId)],
);

/**
 * An access token and its refresh token. Refreshing revokes this row and
 * inserts a new one with the same `grant_id` in one transaction, so a grant
 * (one consent, one "connection" on /settings/connections) has at most one
 * live row.
 */
export const mcpAccessTokens = pgTable(
  "mcp_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** One approval of the consent screen, kept across refreshes. */
    grantId: uuid("grant_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
    }).notNull(),
    /** When the member approved the grant; copied on every refresh. */
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mcp_access_tokens_member_id_idx").on(t.memberId),
    index("mcp_access_tokens_grant_id_idx").on(t.grantId),
  ],
);

/**
 * Tokens a trusted service (baumy-brain) sends as `Authorization: Bearer`
 * to `/api/v1/actions` (SPEC §6.3, §6.6, issue #27). Minted on
 * /admin/connections (issue #104) or by `packages/db/scripts/service-token.ts`,
 * both of which show the token once; only
 * its sha256 is stored, so the plaintext lives in brain's env and never in
 * ours. `scopes` names what the token may do (`brain`: the brain surface).
 * Revoking sets `revoked_at`; a revoked token is never found again. One
 * live token per name, so rotating is: revoke, then mint the name again.
 */
export const serviceTokens = pgTable(
  "service_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** For example `baumy-brain`; the script revokes by name. */
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /**
     * When brain last called with it, recorded at most every
     * SERVICE_TOKEN_TOUCH_EVERY_MS (issue #104: /admin/connections shows it).
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    // One live token per name; a revoked name may be minted again (rotation).
    uniqueIndex("service_tokens_live_name_uq")
      .on(t.name)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
