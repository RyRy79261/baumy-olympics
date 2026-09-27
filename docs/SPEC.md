# Baumy Olympics: product and technical spec

Status: draft v1, 2026-09-27. Owner: Ryan. Decisions are recorded in `docs/decisions/`. Owner decisions and the questions still open are listed at the end (section 12).

Reference repos (read-only, copy from these):

- **camp-404**: `/home/ryan/repos/Personal/camp-404` (branch `main`). Used for the app shell, auth, calendar, Blob, db, tests and AGENTS rules.
- **afrikaburn**: `/home/ryan/repos/Personal/afrikaburn-contributors-app`. Read it with `git show origin/main:<path>` because the local branch is stale. Used for CI, e2e, Neon previews and commitlint.
- **intake-tracker**: `/home/ryan/repos/Personal/intake-tracker`. Used for the AI command pipeline and the MCP OAuth server.
- **baumy-brain**: `/home/ryan/repos/Personal/baumy-brain`. The live Telegram bot `@baumy_bot` (Next.js, Neon, grammY and Inngest on Vercel), which owns the shopping list, reminders and memory. When the owner says "Baumy bot" or "Baumy brain", this is the system he means.
- **Not baumy-bot**: the GitHub repo `RyRy79261/baumy-bot` (`/home/ryan/repos/Personal/baumy-bot`) is an unrelated, unfinished ROS2 companion-robot prototype with no Telegram code. It is out of scope; a future robot could call the same MCP or action API.

---

## 1. Vision

The kitchen iPad is the house's shared screen. It shows what's on today, what needs buying, whose turn it is and who is winning. The chores game makes the boring work competitive: points for doing chores, bonuses for streaks, and a bonus for breaking someone else's streak. At the end of the year the winner takes the savings pot. Baumy the pixel cat is the face of the app. You can talk to it, and everything it does goes through the same actions as the buttons.

## 2. Users and devices

| Actor                            | Device                                        | Identity                                                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Housemate (2 now, allow up to 6) | Their own phone (PWA) or laptop               | Better Auth session (cookie), or a bearer token later on native                                                                                                                                                                                            |
| Kitchen kiosk                    | iPad in landscape, always on, home-screen PWA | A paired **kiosk device** token, not a person. The actor is chosen by tapping an avatar. Attesting (confirming, disputing or vouching for a completion) needs that member's PIN. Admin actions and personal settings need a real session, never the kiosk. |
| Admin                            | Any member with `role=admin`                  | Same as a housemate                                                                                                                                                                                                                                        |
| Baumy (Telegram)                 | baumy-brain server                            | A service token, with the actor given as a Telegram user id and mapped to a member                                                                                                                                                                         |
| Chatbots (claude.ai etc.)        | MCP client                                    | OAuth 2.1 access token tied to a member                                                                                                                                                                                                                    |

## 3. Features

### 3.1 Hub (home and kiosk home)

This is a single screen with no scrolling at 1180×820 (iPad Air, landscape):

- a clock and date (Europe/Berlin);
- **today's calendar** (next 5 events);
- **chores**: which are due or overdue from the natural interval, and each chore's current streak holder;
- **the leaderboard**: season points, the gap to the leader and the pot total;
- **the shopping list** (open items, tap to check off);
- **pinned notes**;
- **the Baumy button**, bottom right, which opens the command sheet.

### 3.2 Chores game

This covers:

- logging a completion, confirming it, disputing it, and undoing it within 10 minutes;
- photo proof;
- streaks, break bonuses, a season scoreboard and a pot tracker;
- frequency-based weight suggestions.

Section 4 has the full rules.

### 3.3 Shared calendar

This is a house Google Calendar (which one is still open, section 12), shared with a **new service account created just for this house** (not camp-404's) that has "Make changes to events" access. You can list events for a day, week or month, create events (all-day or timed), edit them and delete them. The house's calendar data lives only in Google, and we store no local copy.

### 3.4 Shopping list

baumy-brain owns the list (`baumy_list_items`). Olympics reads it and writes to it through a small API on the brain side (ADR 0003), so "buy milk" in Telegram and on the kiosk is the same row. Actions are: list, add (one or several items) and check off.

### 3.5 Notes

Short household notes, such as "plumber comes Tue" or the wifi guest code (not secrets). Each note has a title, a markdown body, an optional colour and pinned flag, and an author. Olympics owns them, because brain has no notes store. We never store secrets in notes; brain already handles encrypted secrets.

### 3.6 Baumy the cat and the AI command

- **Sprite.** Baumy is a 16-bit sprite (drawn from `design/baumy-reference.png`, section 7) with these states: `idle`, `listening`, `thinking`, `talking`, `happy` (points awarded), `sad` (error), and `sleeping` (night mode).
- **Command sheet.** You type or hold to speak. Speech is transcribed by Groq `whisper-large-v3-turbo`, as in intake-tracker. The text goes to `POST /api/ai/command`, and Claude receives the registry tools (section 6.3).
- **Read tools** run inside the loop and are answered in Baumy's speech bubble, for example "who's winning?" or "what's on Saturday?".
- **Write tools** are never run inside the loop. They come back as **proposals** in a review list, copied from intake-tracker's voice-panel pattern. Each row can be edited and approved or rejected. There is "Approve all", which skips rows marked `risk: "destructive"`. When saving, each approved row is sent to `runAction` with its proposal id as the idempotency key.

---

## 4. Scoring rules (ruleset v1)

Everything in this section is pure code in `packages/core/src/scoring/`:

- `ruleset.ts`, `streak.ts`, `points.ts`, `replay.ts`, `validate.ts`, `verification.ts`, `frequency.ts` and `standings.ts`.
- Nothing in it touches the DB, calls `Date.now()` or uses randomness. The caller passes `now`.
- All points are integers.

### 4.1 Definitions

| Term                         | Rule                                                                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Streak**                   | Kept **per chore**. A chore has one _holder_ and a _length_: the number of consecutive counted completions by the same member, in `occurred_at` order. A streak ends only when another member completes the chore, or at the end of the season. Time alone never ends it (there is no lapse). |
| **Break**                    | Someone other than the holder completes the chore. The breaker gets a break bonus that scales with the broken length, and starts at length 1. The previous holder loses nothing: scores only ever go up.                                                                                      |
| **Cooldown**                 | A completion of the same chore within `cooldown_minutes` of the last _live_ one, by anyone, is **rejected** and not stored. The default is `clamp(0.5 × interval, 1h, 7d)`.                                                                                                                   |
| **Counted** (for scoring)    | Status is `confirmed`, `finalized`, or `pending` with `confirm_mode=optimistic`. Partner-mode `pending`, `disputed` and `voided` are skipped. Optimistic pending ones show as provisional (dimmed). The counted set therefore only changes on a write, never because time passed.             |
| **Live** (for the validator) | Any completion that is not `voided` at `now` (using `effectiveStatus(now)`), including `disputed` and unexpired partner-mode `pending`.                                                                                                                                                       |
| **Season**                   | A calendar year in Europe/Berlin time, stored as UTC timestamptz. Streaks reset at the start of each season (1 Jan), and at no other time.                                                                                                                                                    |
| **Verified**                 | Someone other than `done_by` logged the completion or confirmed it.                                                                                                                                                                                                                           |

### 4.2 Formula

```ts
export const RULESET_V1 = {
  version: 1,
  streakStepPct: 25,                           // +25% per consecutive completion, no cap
  breakPctPerLen: 20, breakLenCap: 10,         // 20% of base per broken length, cap 200%
  minBrokenStreak: 1,
  undoWindowMin: 10, challengeWindowH: 24, partnerConfirmExpiryH: 72, maxBackdateH: 24,
} as const;

multiplierPct(n) = 100 + 25·(n−1)                           // uncapped
pctOf(base, pct)  = floor((base·pct + 50) / 100)            // integer, round half up
streakTotal       = pctOf(base, multiplierPct(n))
breakPts          = brokenLen ≥ minBrokenStreak ? pctOf(base, 20·min(brokenLen, 10)) : 0
total             = streakTotal + breakPts
```

**Replay** (`replayChore(completions, ruleVersions)`):

1. Keep only counted completions. Sort them by `(occurred_at, logged_at, id)`.
2. Start with `holder = null` and `len = 0`.
3. For each completion:
   - Look up the rule version in effect at `occurred_at`.
   - If the holder did it again: `len++`, and there is no break.
   - Otherwise: `broken = len` if there was a holder, `holder = doneBy`, `len = 1`.
   - Emit the score.

The results are written to `completion_scores`, and the whole (chore, season) is rebuilt on every write to that chore.

**Write validator** (`validateNewCompletion`) checks against _live_ completions (so a dispute cannot open a cooldown gap that reinstatement later closes). For `COOLDOWN` only, it also loads the previous live completion across the season boundary. It returns one of these errors:

- `COOLDOWN` (with `retryAt`; landing exactly on the cooldown boundary is allowed)
- `FUTURE` (more than 2 minutes after now)
- `BACKDATE_TOO_FAR` (more than 24h ago)
- `OUT_OF_ORDER` (before the last live completion; history is append-only)
- `SEASON_CLOSED`
- `PHOTO_REQUIRED`
- `ARCHIVED_CHORE`

### 4.3 Confirmation

- **Logged for someone else** (`logged_by ≠ done_by`): the completion is verified when it is created. On the kiosk, the person logging for someone else must enter their PIN.
- **Self-claim with `confirm_mode=optimistic`** (the default): the status is `pending` and the points count provisionally. It becomes `finalized` at `logged_at + 24h` unless it is disputed. Any other member can confirm it early.
- **Self-claim with `confirm_mode=partner`**: the completion is not counted until another member confirms. If nobody confirms within 72h, it becomes `voided` (`unconfirmed`). It blocks the cooldown until then.
- **Disputes**: another member can dispute within the 24h window and must give a reason. A disputed completion is excluded from scoring but still blocks the cooldown.
- **Undo**: the person who logged a completion can void it themselves within 10 minutes.

**Transitions** (pure, in `verification.ts`; every one is a compare-and-set write except the time-derived ones marked ⏱):

| From                                              | Event                                     | To                                                                              |
| ------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `pending`                                         | another member confirms                   | `confirmed`                                                                     |
| `pending` (optimistic)                            | ⏱ `finalizes_at <= now`                   | `finalized`                                                                     |
| `pending` (partner)                               | ⏱ 72h without confirmation                | `voided` (`unconfirmed`)                                                        |
| `pending`                                         | another member disputes inside the window | `disputed`                                                                      |
| `disputed`                                        | disputer withdraws                        | `pending`; `finalizes_at = max(original, now + 1h)`                             |
| `disputed`                                        | doer concedes                             | `voided` (`conceded`)                                                           |
| `disputed`, no photo                              | ⏱ challenge window ends                   | `voided` (`disputed`)                                                           |
| `disputed`, photo attached before the window ends | ⏱ window ends                             | stays `disputed` until withdraw, concede or an admin ruling (`resolve_dispute`) |
| `pending`/`disputed`                              | logger undoes within 10 min               | `voided` (`undone`)                                                             |

A photo attached after the challenge window has no effect on the timeout. Time-derived transitions are **computed when data is read** with `effectiveStatus(now)`. None of them changes the counted set (they move rows between non-counted states, or from optimistic pending to finalized), so stored scores never go stale. The daily cron only persists them.

### 4.4 Frequency-derived weights

The natural interval is measured over finalized or confirmed, never-disputed completions by everyone:

- The window is `clamp(8 × current interval, 90d, 365d)`.
- Each interval is winsorised to `[cooldown, 4 × previous median]`.
- At least 6 intervals are needed; with fewer, the result is `insufficient_data`.
- `I` is the median interval, in days.

```
raw = 10 × (effort_factor_pct / 100) × sqrt(I_days)      // daily=10, 4-day=20, weekly≈26, monthly≈55
suggest only if |raw − current| ≥ max(2, 10% current)      // dead-band
suggested = clamp(round(clamp(raw, 0.75·cur, 1.25·cur)), 5, 60)
cooldown = clamp(0.5·I, 60min, 7d)
```

- Suggestions are recomputed weekly (on the first run whose Berlin weekday is Monday, computed from `now` by `time.ts`).
- An admin can **Schedule**, **Edit & schedule** or **Dismiss** a suggestion. A scheduled one applies at the next Monday 00:00 Berlin, at least 48h ahead, unless another member vetoes it in the meantime.
- Applying a suggestion inserts a new `chore_rule_versions` row, so changes are never retroactive.
- Each chore can have at most one applied change per 28 days.
- Weights, adjustments and prize mode can only be changed in the **UI**. The AI command, MCP and Telegram cannot change them.

### 4.5 Year-end prize

- **v1 uses `points` only, winner takes all:** the season total of `total_pts`, plus approved adjustments. The winner takes the whole pot.
- The mode is stored in `seasons.prize_mode`. The enum keeps `heaviest_streak` (best single run, as the sum of `base_pts`) and `longest_streak` (longest run length) for later, but they are not implemented in v1, and `set_prize_mode` (UI only) accepts only `points`. The mode locks at the season's first completion.
- Ties are broken by season points, then by the number of verified completions, then by who reached the value first.
- At Dec 31 24:00 Berlin the season becomes `closing`. It becomes `closed` once every challenge window has passed (up to 72h). The winner is written at that point.
- Monthly pot contributions are logged in `pot_contributions`.

### 4.6 Worked examples (these become test fixtures)

Chores: Trash (base 20, cooldown 48h), Dishes (10, 12h), Bathroom (26, 3.5d), as seeded (section 4.7).

| #   | Scenario                                                                                    | Result                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Ryan takes the trash out 6 times in a row                                                   | 20, 25, 30, 35, 40, 45 (no cap). The first four total 110; all six total 195.                                                     |
| E2  | The partner breaks Ryan's trash streak of k                                                 | Totals: k=1 → 24; k=4 → 36; k=5 → 40; k≥10 → 60. The partner's streak is now 1.                                                   |
| E3  | Trash in strict alternation R,P,R,P… (8 completions)                                        | 20 + 7×24 = 188, split 92/96. Doing all 8 alone would give 20 + 25 + … + 55 = 300.                                                |
| E4  | Dishes: n=2, then breaking a 3-streak                                                       | 12.5 rounds to **13**; the break gives 10 + 6 = **16**.                                                                           |
| E5  | Trash Mon 08:00, then another attempt Mon 20:00, or the partner on Tue 09:00                | Both attempts get `COOLDOWN`, with retryAt Wed 08:00.                                                                             |
| E6  | Dishes 4-streak, last done Mon 20:00, next done by the same person Fri 21:00 (4 days later) | No lapse: the streak continues to n=5 and scores `pctOf(10, 200)` = **20**.                                                       |
| E7  | Bathroom at current 35, intervals [6,7,7,8,5,9,7,14,6,7,7,8]                                | I=7, raw 26.46, suggestion **26**, cooldown 3.5d.                                                                                 |
| E8  | Trash at current 15, I=4                                                                    | raw 20, clamped to 18.75, suggestion **19**. The next cycle's difference of 1 is inside the dead-band, so there is no change.     |
| E9  | A disputed Bathroom claim, then a photo, then the dispute is withdrawn                      | Excluded while disputed. It returns to `pending`, finalizes at `max(logged_at + 24h, withdraw + 1h)`, and the chore is re-scored. |
| E11 | Ryan logs Trash Mon 08:00; the partner disputes it and tries Trash at 10:00                 | `COOLDOWN` (a disputed row is live).                                                                                              |
| E12 | Dishes at 23:50 Dec 31, again at 00:05 Jan 1                                                | `COOLDOWN` across the season boundary; the Jan streak still starts at 1.                                                          |
| E10 | Ryan has 3020 points and a best run of 9×20=180; the partner has 2850 and 21×10=210         | `points` (v1): Ryan wins the whole pot. Run length and weight do not matter.                                                      |

### 4.7 Seed chores

Starting values follow the weight formula with the expected interval `I` and effort 100%: `base ≈ 10·sqrt(I_days)`, `cooldown = clamp(0.5·I, 1h, 7d)`. They are seeded as `chore_rule_versions` with `source = seed`, and frequency suggestions take over once there is data.

| Chore               | Expected interval | Base | Cooldown |
| ------------------- | ----------------- | ---- | -------- |
| Trash               | 4d                | 20   | 48h      |
| Recycling           | 7d                | 26   | 3.5d     |
| Dishes              | 1d                | 10   | 12h      |
| Dishwasher (unload) | 2d                | 14   | 24h      |
| Bathroom            | 7d                | 26   | 3.5d     |
| Vacuum              | 7d                | 26   | 3.5d     |
| Mop                 | 14d               | 37   | 7d       |
| Laundry             | 3d                | 17   | 36h      |
| Plants              | 4d                | 20   | 48h      |
| Fridge clean-out    | 30d               | 55   | 7d       |
| Keller              | 30d               | 55   | 7d       |

---

## 5. Data model (Drizzle, `packages/db/src/schema.ts`)

The schema is one hand-written file and is the only source of truth. Migrations are generated only (see AGENTS.md). All ids are `uuid` with `defaultRandom()`, except where noted, and all times are `timestamptz`. Every household-scoped table has `household_id`. There is only one household, but the column costs nothing and matches brain's `group_id` scoping.

**Auth (Better Auth, copied from camp-404 `packages/db/src/schema.ts` around lines 376–530):** `user`, `session`, `account`, `verification`, `rate_limit`. The `passkey` and `two_factor` tables are left out of v1.

**Identity**

| Table                 | Columns                                                                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `households`          | `name`, `tz` (default `Europe/Berlin`)                                                                                                                                                                                                                               |
| `members`             | `household_id`, `auth_user_id text unique null` (no FK, as camp-404 does), `display_name`, `avatar_sprite`, `color`, `role` (`admin`, `member`), `kiosk_pin_hash null` (scrypt), `kiosk_pin_locked_at null`, `telegram_user_id bigint unique null`, `deactivated_at` |
| `telegram_link_codes` | `code_hash` PK, `member_id`, `expires_at` (10 min), `used_at`, `used_by_tg`. At least 8 random characters, single use, claimed with `UPDATE … RETURNING`.                                                                                                            |
| `invite_codes`        | `code` PK (lowercased), `role`, `max_uses`, `use_count`, `expires_at`, `revoked_at`, `created_by`. Claimed atomically with `UPDATE … RETURNING`, as in camp-404 `packages/db/src/invite-codes.ts`                                                                    |
| `kiosk_devices`       | `name`, `token_hash` unique (sha256), `paired_by`, `last_seen_at`, `revoked_at`                                                                                                                                                                                      |
| `pin_attempts`        | Reuses `action_rate_limit` with keys `pin:<device>:<member>` (5 per 15 min) and `pin24:<member>` (10 per 24h, then `kiosk_pin_locked_at` is set). It is not a separate table.                                                                                        |

**Game**

| Table                 | Columns                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chores`              | `name`, `sprite`, `proof_mode` (`none`, `optional`, `required`), `confirm_mode` (`optimistic`, `partner`), `effort_factor_pct` (50–300), `archived_at`                                                                                                                                                                                                               |
| `chore_rule_versions` | `chore_id`, `effective_from`, `base_points` (1–200), `cooldown_minutes`, `source` (`seed`, `manual`, `suggestion`), `suggestion_id`, `created_by`. Unique on `(chore_id, effective_from)`.                                                                                                                                                                           |
| `seasons`             | `year`, `starts_at`, `ends_at`, `prize_mode`, `status` (`active`, `closing`, `closed`), `winner_member_id`, `finalized_at`. Unique on `(household_id, year)`.                                                                                                                                                                                                        |
| `completions`         | `chore_id`, `season_id`, `done_by`, `logged_by`, `occurred_at`, `logged_at`, `source` (the `Surface` enum: `ui`, `kiosk`, `ai`, `mcp`, `brain`), `status`, `verified_by`, `verified_at`, `finalizes_at`, `photo_pathname`, `note`, `void_reason`, `client_request_id`. Unique on `(household_id, client_request_id)`. Index on `(chore_id, season_id, occurred_at)`. |
| `completion_scores`   | `completion_id` PK, `rule_version_id`, `ruleset_version`, `streak_len`, `multiplier_pct`, `base_pts`, `streak_pts`, `broken_member_id`, `broken_len`, `break_pts`, `total_pts`, `computed_at`. This is output of the replay and is always rebuildable.                                                                                                               |
| `disputes`            | `completion_id`, `raised_by`, `reason`, `resolution`, `resolved_at`                                                                                                                                                                                                                                                                                                  |
| `point_adjustments`   | `season_id`, `member_id`, `points`, `reason`, `created_by`, `approved_by`. Check `approved_by <> created_by`.                                                                                                                                                                                                                                                        |
| `weight_suggestions`  | As in the game design: the window, `sample_intervals`, `median_interval_minutes`, `raw_points`, `current_points`, `suggested_points`, the suggested cooldown, `status`, `applies_at`, `vetoed_by`                                                                                                                                                                    |
| `pot_contributions`   | `season_id`, `month` (date), `amount_cents` (> 0), `contributed_by`, `note`                                                                                                                                                                                                                                                                                          |

**Hub**

| Table   | Columns                                                                        |
| ------- | ------------------------------------------------------------------------------ |
| `notes` | `title`, `body_md`, `color`, `pinned`, `author_id`, `updated_at`, `deleted_at` |

**Platform**

| Table                                                      | Columns                                                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action_requests`                                          | PK `(actor_member_id, source, request_id)`, `action`, `input_hash`, `status` (`pending`, `done`, `failed`), `result jsonb`, `created_at`. Every write action's idempotency ledger, owned by `runAction`. |
| `audit_events`                                             | `bigserial` id, `actor_member_id`, `source`, `action`, `entity`, `entity_id`, `payload jsonb`, `at`. Owned by `runAction`, written in the **same transaction** as the change.                            |
| `action_rate_limit`                                        | Copied from camp-404 `packages/db/src/rate-limit.ts`                                                                                                                                                     |
| `service_tokens`                                           | `name` (for example `baumy-brain`), `token_hash`, `scopes text[]`, `revoked_at`                                                                                                                          |
| `mcp_oauth_clients`, `mcp_auth_codes`, `mcp_access_tokens` | Copied from intake-tracker `packages/db/src/schema.ts`, plus `member_id` on codes and tokens. Tokens are stored hashed.                                                                                  |
| `ai_usage`                                                 | `member_id`, `provider`, `input_tokens`, `output_tokens`, `audio_seconds`, `at`                                                                                                                          |

**Writes and transactions**

- Completion writes use the pooled (WebSocket) driver in the transaction `runAction` opens. `logCompletion(tx, …)`:
  1. `SELECT … FROM chores WHERE id=$1 FOR UPDATE`;
  2. load the live completions for the season (plus the previous live one for cooldown);
  3. `validateNewCompletion`;
  4. insert;
  5. `replayChore`;
  6. upsert `completion_scores`.
  - `runAction` writes `audit_events` and `action_requests` in the same transaction; `logCompletion` writes neither.
- Reads use the HTTP driver.

---

## 6. Architecture

### 6.1 Repo layout (pnpm 10, turbo, Node ≥22, TypeScript strict with `noUncheckedIndexedAccess`)

```
apps/web                    Next.js 16 App Router (the only deployable)
  app/(hub)/...             member pages: home, chores, scoreboard, calendar, shopping, notes, settings, admin
  app/kiosk/...             kiosk shell (device-token auth)
  app/api/auth/[...path]    Better Auth handler (fail-closed)
  app/api/ai/{command,transcribe}
  app/api/mcp/[transport] + app/api/mcp/oauth/* + well-known rewrites
  app/api/v1/actions/[name] service-token endpoint (baumy-brain)
  app/api/uploads/completion-photo, app/api/blob (proxy)
  app/api/cron/daily, app/api/health
  lib/actions/              ACTION REGISTRY (ADR 0002)
  lib/integrations/{google-calendar,brain,groq,claude}.ts
packages/core               pure domain: scoring/*, time (Berlin), no I/O
packages/db                 schema, drivers, queries per domain, PGlite harness
packages/auth               Better Auth config + env resolvers
packages/ui                 pixel kit (shadcn base, restyled) + sprites
packages/types              Zod schemas shared by actions/UI
packages/ai-prompts         system prompt, model tiers (SDK-free)
packages/{eslint-config,typescript-config}
```

**Where to copy from**

| What                                                                                   | Source                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo scaffolding, turbo `globalEnv`, tsconfigs, `transpilePackages`, `typedRoutes` | camp-404 `turbo.json`, `packages/typescript-config/*`, `apps/web/next.config.ts`                                                                                                     |
| Build outputs excluding `.next/dev/**`                                                 | afrikaburn `turbo.json` (origin/main)                                                                                                                                                |
| Drivers                                                                                | camp-404 `packages/db/src/index.ts` (`createHttpDb`, `createPooledDb`, `withTransaction`, `__setDbOverride`, `NEON_LOCAL_PROXY`), plus afrikaburn's WebSocket-for-reads proxy switch |

### 6.2 Auth (ADR 0001)

- Self-hosted **Better Auth pinned to exactly `1.6.25`**, copied from camp-404 `packages/auth/src/config.ts` and `env.ts`.
- **Sign-in methods:** email and password, with Google as an optional social provider.
- **Session:** `session.expiresIn = 30d`, `updateAge = 1d`, cookie cache 300s. The session is longer than camp-404's because this is a household app. Sessions run in the app's own process against our own Neon tables.
- **Hardening:** fail closed when `BETTER_AUTH_SECRET` is missing (`authMayServe`); `changeEmail` is off; trusted origins are absolute.
- **Mobile-friendly tokens:** the Better Auth `bearer()` plugin is on from day one, so a future Capacitor or native shell can send `Authorization: Bearer`. This avoids the Neon Auth problem on Android. `lib/auth.ts#getActor()` accepts a cookie session, a bearer token, or a kiosk-device cookie, and returns one `Actor`. The bearer plugin runs with `requireSignature: true`: the token is the signed cookie value from the `set-auth-token` header, so a raw `session.token` read from the database is not a credential (added 2026-09-27, issue #6).
- **Membership:** sign-up is open, but having no `members` row means `/join` (redeem an invite code). `FOUNDER_EMAILS` bootstraps the first admin.
- **Kiosk:**
  1. An admin creates a pairing code on their phone. It has 8 characters, lasts 10 minutes and can be used once.
  2. The iPad opens `/kiosk/pair` and enters it.
  3. The server stores `kiosk_devices.token_hash` and sets a `baumy_kiosk` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`) that lasts 1 year.
  - On the kiosk, tapping an avatar sets the acting member for self-claims. Confirming, vouching for someone else, disputing, and editing notes or calendar entries require that member's 4–6 digit PIN.
  - The PIN is sent with each attested request and verified in that request. No attestation state is stored, so the next person at the kiosk cannot inherit it.
  - PIN attempts are limited to 5 per 15 minutes per device and member, and 10 failures per 24h per member lock kiosk attestation for that member (`kiosk_pin_locked_at`, an audit row and a notice on their next session) until they reset the PIN from their own session.
- **Gates:** `requireMember` (member session, MCP or brain actor; kiosk actors only for actions with `surfaces ∋ "kiosk"`), `requireAdmin` (admin with a real session), `requireAttested` (see §6.3) and `requireSession` (`actor.kind === "member"` from a real cookie or bearer session, never the kiosk). `requireSession` guards setting or changing the kiosk PIN (changing needs the current password or a session under 10 minutes old), creating Telegram link codes, `update_my_profile`, MCP consent and connections, and everything under `/settings`.
- **Rate limits:** two buckets per action (per user and per IP), copied from camp-404 `apps/web/lib/rate-limit.ts`.

### 6.3 Action registry (ADR 0002)

Every read and write that the product offers is **one registry entry**. The UI, the AI command, MCP and the brain endpoint are only adapters around it.

```ts
// packages/types: one Zod enum, also the pg enum for completions/audit_events/action_requests.source
export const Surface = z.enum(["ui", "kiosk", "ai", "mcp", "brain"]);
// apps/web/lib/actions/define.ts
export interface ActionDef<I extends z.ZodType, O> {
  name: ActionName; // snake_case, ^[a-z0-9_]{1,64}$ (valid Claude + MCP tool name)
  title: string;
  description: string; // description is the LLM tool description
  consent: string; // plain-language line for MCP consent screen (typed map, intake pattern)
  kind: "read" | "write";
  risk: "safe" | "confirm" | "destructive";
  surfaces: Surface[]; // admin-only actions: ["ui"] only
  requires: Gate | ((ctx, input) => Gate); // input-aware, e.g. log_completion: done_by ≠ actor → "attested"
  transactional?: boolean; // default true; false for external calls (Google, brain)
  input: I; // Zod v4 → z.toJSONSchema for Claude/MCP
  preview?(ctx, input): Promise<string>; // "Log Trash for Ryan: +25 (streak 2)"
  execute(ctx: ActionCtx, input: z.infer<I>): Promise<ActionResult<O>>;
}
// Gate = "member" | "admin" | "attested" | "session" | "service"
// ActionCtx = { actor: Actor; source: Surface; householdId; requestId; pin?: string; now: Date; db }
// ctx.now comes from lib/clock.ts (real time, or the E2E test clock)
```

- **`runAction(name, rawInput, ctx)`** is the only entry point. It does these in order:
  1. checks the surface is allowed;
  2. validates the input with Zod;
  3. resolves `requires(ctx, input)` and runs that gate (one gate function per concern);
  4. rate-limits;
  5. claims the idempotency key with `INSERT … ON CONFLICT DO NOTHING RETURNING` on `(actor, source, requestId)`. A replay with the same input hash returns the stored result; a different input returns `IDEMPOTENCY_CONFLICT`;
  6. calls `execute` in the same transaction as the claim, then writes `audit_events` and the result. It is the only writer of those two tables.
  - For `transactional: false` actions, the claim is committed first as `pending`, `execute` runs with no transaction open, and audit and result are written in a short second transaction.
  - It returns `{ok: true, data} | {ok: false, code, message}`. The `message` is a sentence a user can act on, for example "Trash was done 12h ago; you can log it again from Wed 08:00."
- **Attestation per actor kind:** a cookie or bearer session is attested for its own member. MCP and brain tokens count as the linked member's own session. The kiosk always needs `ctx.pin`, verified in the same request. Kiosk AI proposals that need attestation show a PinPad in the review sheet.
- **UI:** each server action file (`"use server"`, async exports only) calls `runAction(name, formData, ctxFromSession)`.
- **AI command:** `POST /api/ai/command` takes `{text, history?}`.
  - Claude gets the tools for `surfaces ∋ "ai"`.
  - Read tools are executed inside the loop (at most 6 turns).
  - The first write `tool_use` blocks end the loop and are returned as proposals `{proposalId, name, input, preview}`, each validated and previewed on the server.
  - The client runs approved proposals through `POST /api/actions/run`.
  - Port intake-tracker's `apps/web/src/app/api/ai/_shared/claude-call.ts` for handling refusal, `max_tokens` and `pause_turn`, and for deadlines, and its `packages/ai-prompts/src/models.ts` for the model tiers.
  - The system prompt includes the date and time in Berlin, the acting member, the members (with their ids) and the chores (with their ids).
- **MCP:** `/api/mcp/[transport]` uses `createMcpHandler`, and the tools are registered from the registry for `surfaces ∋ "mcp"`.
  - Two scopes: `baumy:read` and `baumy:write`. Write tools are only registered when the token has the write scope.
  - `destructive` actions are never exposed.
  - Port intake-tracker `apps/web/src/lib/mcp/*` and `app/api/mcp/oauth/*`, and read `docs/mcp-replication-briefing.md` first (its 10 gotchas).
  - Better Auth replaces Neon Auth as the identity check in `oauth/authorize`, which also requires an active `members` row (the replacement for intake-tracker's `ALLOWED_EMAILS` whitelist). Codes and tokens store `member_id`; `verifyToken` re-checks that the member is not deactivated. Only the scopes the user ticked are granted.
- **Brain:** `POST /api/v1/actions/{name}` takes a `Bearer <service token>` and `X-Baumy-Actor: tg:<telegram_user_id>`.
  - The actor is resolved through `members.telegram_user_id`; an unknown user gets a 403, except for `link_telegram` (`requires: "service"`), where the member comes from the redeemed code. A tg id already linked to another member is refused.
  - The tools allowed are those with `surfaces ∋ "brain"`.
  - Brain keeps its "LLM proposes, code disposes" gate on its own side. `confirm`-risk writes also need `X-Baumy-Confirmed: 1`, which brain sends only after the user taps an inline confirm button.
  - `GET /api/v1/actions` returns the schema list with `risk`, so brain can build its tools.

**v1 action catalogue**

| Action                                                                                                                                                                                                          | Kind               | Surfaces           | Notes                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `list_chores`, `get_streaks`, `get_standings`, `get_pending_confirmations`, `get_pot`                                                                                                                           | read               | all                |                                                                                                                     |
| `log_completion`                                                                                                                                                                                                | write, confirm     | all                | `done_by` defaults to the actor; logging for someone else needs attestation                                         |
| `confirm_completion`, `dispute_completion`, `undo_completion`, `withdraw_dispute`, `concede_completion`                                                                                                         | write, confirm     | all                | undo only within 10 minutes and only by the logger; withdraw only by the disputer; concede only by the doer         |
| `attach_completion_photo`                                                                                                                                                                                       | write              | ui, kiosk          | upload handled by a route                                                                                           |
| `whoami`                                                                                                                                                                                                        | read               | all                |                                                                                                                     |
| `update_my_profile`                                                                                                                                                                                             | write, safe        | ui                 | `requireSession`                                                                                                    |
| `redeem_invite`                                                                                                                                                                                                 | write              | ui                 | signed-in user with no member row                                                                                   |
| `set_kiosk_pin`, `create_telegram_link_code`                                                                                                                                                                    | write              | ui                 | `requireSession`                                                                                                    |
| `list_events`                                                                                                                                                                                                   | read               | all                |                                                                                                                     |
| `create_event`, `update_event`                                                                                                                                                                                  | write, confirm     | all                |                                                                                                                     |
| `delete_event`                                                                                                                                                                                                  | write, destructive | ui, kiosk, ai      | always confirmed explicitly                                                                                         |
| `list_shopping`                                                                                                                                                                                                 | read               | all                | reads from brain (see below)                                                                                        |
| `add_shopping_items`, `check_off_shopping_items`                                                                                                                                                                | write, safe        | ui, kiosk, ai, mcp | brain already owns these for Telegram, so `brain` is not a surface                                                  |
| `list_notes`, `create_note`, `update_note`, `pin_note`                                                                                                                                                          | read and write     | all                |                                                                                                                     |
| `delete_note`                                                                                                                                                                                                   | write, destructive | ui, kiosk, ai      |                                                                                                                     |
| `link_telegram`                                                                                                                                                                                                 | write              | brain              | `requires: "service"`; redeems a one-time link code a member created in the UI, and sets `members.telegram_user_id` |
| `manage_chore`, `schedule_weight`, `dismiss_weight`, `veto_weight`, `adjust_points`, `add_pot_contribution`, `set_prize_mode`, `mint_invite`, `manage_members`, `pair_kiosk`, `revoke_kiosk`, `resolve_dispute` | write              | **ui only**        | admin actions: UI only, never the AI command, MCP or brain                                                          |

### 6.4 Google Calendar

- Port camp-404 `apps/web/lib/google-calendar.ts` and `lib/integration-config.ts`:
  - no SDK: a hand-signed RS256 JWT, 5s timeouts, a 5-minute read cache cleared on write;
  - results are `ok`, `not_configured` or `unavailable`, and it never throws;
  - the event `id` is generated by the client, so a create that timed out can still be deleted;
  - 404 and 410 on delete count as success.
- **Changes from camp-404:**
  - Timed events are sent as a local `dateTime` (`YYYY-MM-DDTHH:MM:00`) **without an offset**, plus `timeZone: "Europe/Berlin"`. Camp-404 hard-codes `+02:00`, which is wrong for half the year in Berlin because of daylight saving.
  - The actor is recorded in `extendedProperties.private.baumyMember`.
  - Writes use `PATCH` for updates.
  - Private and confidential events are hidden on the kiosk.
- **Consistency:** calendar writes are `transactional: false` actions. As in camp-404 `packages/db/src/calendar-events.ts`, call Google with no transaction open, then write the audit row. If the audit write fails, the `undo` callback deletes the event again.
- **Service account:** a new one for this house only, not camp-404's. Share the chosen calendar with it.
- **Env:** `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_CLIENT_EMAIL`, `GOOGLE_CALENDAR_PRIVATE_KEY`.

### 6.5 Vercel Blob

- The store is private, and the token is passed explicitly on each call. Port camp-404 `apps/web/app/api/uploads/avatar/route.ts` and `app/api/avatar/route.ts`.
- **Completion photos:**
  - Accepted as `image/webp`, `image/jpeg` or `image/png`, up to 5 MB. They are downscaled to 1280px on the client first.
  - Stored at `completions/{completionId}/{rand}.webp`.
  - Served only through `/api/blob?pathname=`, with `nosniff` and `private, immutable`. Like camp-404's proxy, it rejects unsafe paths (`UNSAFE_PATH`: `..`, `//`, `\`, `%`) and anything off the `completions/{id}/` allow-list, and returns 401 unless the caller is a household member or a paired, non-revoked kiosk and the completion is in their household.
- Pixel sprites are **static files** in `apps/web/public/sprites/`, not stored in Blob.
- The daily cron deletes photos 90 days after a completion is finalized.

### 6.6 baumy-brain integration (ADR 0003)

- **Olympics → brain:**
  - `GET /api/kitchen/shopping` and `POST /api/kitchen/shopping/{add,checkoff}` are added to baumy-brain. Brain scopes the house itself with `getHouseChatId(db)` from `lib/identity/house.ts` (the scope id, which honours the `BAUMY_HOUSE_CHAT_ID` override) and reuses `lib/lists/store.ts`. If it returns `''` (bot not in a group yet), the API answers 503 `not_configured`.
  - Auth is `KITCHEN_API_TOKEN`, compared in constant time as in brain's `lib/telegram/verify.ts`.
  - Olympics caches the list for 30s and invalidates the cache on its own writes. The kiosk's periodic refresh bypasses the cache.
- **Brain → Olympics:** `/api/v1/actions/*` (section 6.3), using `BRAIN_SERVICE_TOKEN` (brain holds the plaintext; Olympics stores only its hash). Brain gains an Olympics client, a `/link <code>` command and calendar, chore and standings intents in its own repo.
- **Optional later (read-only):** show brain reminders and dated facts (`upcomingDatedFacts`) on the hub.

### 6.7 Scheduling

- Vercel Hobby only allows daily cron jobs, scheduled in UTC and fired at some point within the hour. There is one job, `GET /api/cron/daily` at `0 2 * * *` UTC, guarded by `CRON_SECRET`. Weekday, `applies_at` and season are computed from `now` with `packages/core/src/time.ts`, never from the schedule. It:
  - persists the finalize and expire status changes, including disputed rows whose window has ended;
  - closes the season when it is due;
  - on Mondays (Berlin), computes weight suggestions and applies any scheduled ones whose veto window has passed;
  - prunes photos.
- Every job is idempotent and safe against double claims (`FOR UPDATE SKIP LOCKED`).
- Correctness never depends on the cron (statuses are derived when read, section 4.3). Hub page loads also run the same sweep lazily, behind a rate-limit row, using camp-404's `apps/web/lib/background-work.ts` pattern.

### 6.8 Env vars

Every variable goes into both `.env.example` and turbo `globalEnv`.

| Group    | Variables                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_LOCAL_PROXY`, `PROD_DB_HOST` (the migrate guard refuses it on previews, ADR 0004)                             |
| Auth     | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `FOUNDER_EMAILS`, `INVITE_CODES` |
| Calendar | `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_CLIENT_EMAIL`, `GOOGLE_CALENDAR_PRIVATE_KEY`                                                                          |
| Blob     | `BLOB_READ_WRITE_TOKEN`                                                                                                                                      |
| AI       | `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `AI_DAILY_COMMANDS_PER_MEMBER`                                                                                          |
| MCP      | `MCP_PUBLIC_URL`                                                                                                                                             |
| Brain    | `BRAIN_BASE_URL`, `KITCHEN_API_TOKEN` (Olympics → brain). `BRAIN_SERVICE_TOKEN` lives only in brain's env; Olympics keeps its hash in `service_tokens`.      |
| Cron     | `CRON_SECRET`                                                                                                                                                |
| E2E      | `E2E_TEST_MODE`, `E2E_*`                                                                                                                                     |

---

## 7. UI direction: 16-bit on the camp-404 shell

- **Structure from camp-404:**
  - a sticky blurred header with a brand tile, a mono eyebrow, the user and a sign-out button (`apps/web/components/console/console-header.tsx`);
  - pill nav that folds into a sheet on small screens (`console-nav.tsx`);
  - every page starts with `PageHeading` and has no container of its own;
  - the content column is `max-w-6xl`;
  - no `loading.tsx`; pending state comes from `useLinkStatus`;
  - errors show inline in forms and as toasts for one-tap actions.
- **Tokens:** kept in `packages/ui/src/styles/globals.css` `@theme`, following camp-404's pattern (Tailwind v4, no config file, and `@source` for package components).
- **The 16-bit skin:**
  - `--radius: 0`.
  - 2px hard borders, plus a stepped "pixel" shadow `box-shadow: 4px 4px 0 0 var(--color-border)` that collapses to `0 0` on `:active`, for a button-press feel.
  - A limited 16-colour palette: a dark night-kitchen background, a warm cream foreground and a **Baumy orange** accent. Each member has an accent colour.
  - The camp-404 `.light` override is used for daytime kiosk mode.
- **Fonts** (`next/font/google`): `Pixelify Sans` for body text and UI, and `Press Start 2P` only for eyebrows, scores and the big numbers. Press Start is hard to read at small sizes.
- **Sprites:**
  - PNG sprite sheets drawn at 16×16 or 32×32 and scaled by an integer amount, with `image-rendering: pixelated`.
  - Animated with CSS `steps()` in a `<Sprite sheet frames fps />` component.
  - Baumy has 7 states (section 3.6). Each chore has an icon, and each member has an avatar.
  - **Source art:** AI-generated pixel art based on the reference picture `design/baumy-reference.png` (a black fluffy cat with heterochromia, one green eye and one blue-violet eye, a pastel party hat with stars, purple and teal fairy lights and trinkets around the neck, in a cosy cluttered maker den), cleaned up by hand and approved by the owner before it ships.
  - Honour `prefers-reduced-motion`, using camp-404's global kill switch.
- **Juice:** a "+25" floating score and a streak flame counter. Breaking a streak shows a "STREAK BROKEN" banner with the broken length.
- **Base:** components start from shadcn/ui (Radix) in `packages/ui` with a restyled cva, as in camp-404 `packages/ui/components.json`.

## 8. Kiosk mode

- **Route:** `/kiosk`, a landscape layout with no page scrolling on the hub.
- **Touch targets:** at least **56px** (with 64px for primary actions), no interaction that depends on hover, and `touch-action: manipulation`.
- **PWA:** a manifest with `display: standalone` and `orientation: landscape`, plus apple-touch icons. A service worker is **not** planned for v1 (it is an online-only kiosk), except for an offline fallback page.
- **Always on:**
  - The Screen Wake Lock API (`navigator.wakeLock`), re-acquired on `visibilitychange`, as a best effort.
  - The documented fallback is iPad Auto-Lock set to Never, plus Guided Access.
- **Night mode:** from 23:00 to 06:30, the screen dims to a sleeping Baumy and a clock, and wakes on touch.
- **Freshness:**
  - The page calls `router.refresh()` every 60s and on focus (bypassing the 30s shopping cache).
  - Every mutation calls `revalidatePath`.
  - There are no websockets in v1.
- **Idle:** after 60 seconds idle, the screen returns home and clears the selected actor. This stops the next person acting as the previous one.

## 9. Security

- Auth fails closed. Kiosk, service and MCP tokens are opaque and stored as **hashes** (sha256), and compared in constant time. Better Auth 1.6.25 stores `session.token` in **plaintext** (camp-404 `packages/db/src/schema.ts:398`), so a DB read means session takeover: treat DB credentials accordingly.
- There is one gate function per concern (`requireMember`, `requireAdmin`, `requireAttested`, `requireSession`). Gates are never hand-rolled at a call site, and every surface goes through `runAction`.
- Cookie-authenticated POST route handlers (`/api/actions/run`, `/api/ai/command`, uploads) check `Origin`/`Sec-Fetch-Site`, since only server actions get Next's built-in check.
- Admin actions are available in the UI only. The in-app AI never runs a write without a human approving it in the UI. Two surfaces approve outside our UI, by design: brain must get an inline-button confirmation for `confirm`-risk writes (enforced by `X-Baumy-Confirmed`), and MCP relies on the chatbot client's tool approval plus the explicit `baumy:write` consent. Destructive actions are never exposed over MCP or to brain.
- Every mutation writes `audit_events` in the same transaction. Decision writes use compare-and-set (`WHERE status = expected … RETURNING`).
- Inputs are validated with Zod at every boundary. Uploads use a MIME allow-list with no SVG, and Blob is private behind a proxy.
- Tool results sent back to Claude and MCP are generic on error, so no SQL or stack traces leak. Prompt-injection surface: calendar titles and note bodies are data. They are shown to Claude inside the tool results, and a write still requires human approval.
- Secrets are never logged (port camp-404's `redactSecrets`). `E2E_TEST_MODE` refuses to boot on Vercel.
- Dependabot is on, with better-auth excluded (it is pinned and watched by hand). Previews for Dependabot branches are skipped, and preview migrations refuse to run against the prod DB (ADR 0004).

## 10. Testing strategy

| Layer                     | Tool                                                                                                                                                                                                              | Floor                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `packages/core` (scoring) | Vitest + **fast-check** property tests + the E1–E10 fixtures                                                                                                                                                      | 95% lines and branches, 100% on `scoring/*` |
| `packages/db`             | Vitest + in-process **PGlite** that replays the real migrations (port camp-404 `packages/db/src/__tests__/_harness.ts`)                                                                                           | 75%                                         |
| `apps/web/lib/**`         | Vitest in jsdom, with an alias from `server-only` to an empty module (camp-404 `apps/web/vitest.config.ts`). Covers every action's `execute`, surface and permission rules, and each adapter.                     | 90%                                         |
| E2E                       | Playwright against `next start` on a **real Docker Postgres** (afrikaburn `scripts/e2e-local.sh`, `docker-compose.local.yml`). Projects: `desktop-chromium`, `ipad-landscape` (1180×820, touch) and `mobile-360`. | Critical flows                              |

- In E2E, external services (Google Calendar, Claude, Groq, brain, Blob) sit behind adapter interfaces with in-memory fakes, which are chosen when `E2E_TEST_MODE=1`. Users are created through the real UI, and there is no DB back door except the seed script.
- Server time comes from `apps/web/lib/clock.ts`. With `E2E_TEST_MODE=1` it adds an offset set through a test-only route, so specs can advance past the 24h window; Playwright's clock alone only moves the browser.
- **Critical E2E flows:**
  1. Sign up, redeem an invite, reach the hub.
  2. Kiosk: pair, log a chore as self, have the partner confirm with a PIN, check the scoreboard.
  3. Cooldown toast.
  4. Break a streak and check the bonus shown.
  5. Dispute a completion, attach a photo, withdraw the dispute.
  6. Create and delete a calendar event.
  7. AI command proposal: approve it, then check that retrying does not duplicate it.
  8. MCP: OAuth round trip and one read tool.
- **CI:** `pnpm turbo run format:check lint typecheck test build`, the e2e matrix, the coverage report and the migration drift check (`drizzle-kit generate` must leave `packages/db/migrations` clean). A single required check is named `CI pass` (afrikaburn `.github/workflows/ci.yml`).

## 11. Non-goals (v1)

- A native iOS or Android app. The PWA comes first; the bearer plugin keeps the native option open.
- Multiple households, or selling the product to others.
- Real money movement. The pot is a ledger only, and transfers happen at the bank.
- Replacing brain's memory, reminders or shopping list. We also do not copy brain's tables.
- Offline-first sync (unlike intake-tracker). The server is authoritative.
- Websockets or realtime push. Recipes, meal planning and timers are also out.
- Passkeys and 2FA, which are deferred. Better Auth plugins can add them later.
- Admin actions (chores, weights, adjustments, pot, prize mode, members, kiosk pairing) through the AI command, MCP or brain. They are UI only.
- Prize modes other than `points`.
- The `baumy-bot` ROS2 robot. A future robot could call the same MCP or action API.

## 12. Owner decisions and open questions

Decided 2026-09-27:

1. **Prize:** `points`, winner takes all. It is the only v1 mode.
2. **Breaking a 1-streak** pays a bonus (`minBrokenStreak = 1`).
3. **Confirmation:** optimistic, with a 24h dispute window.
4. **Resets:** streaks reset on 1 Jan only. There is no lapse; a streak ends only when another member does the chore.
5. **Weight changes:** one member schedules, the other has 48h to veto. The manual effort factor stays.
6. **Starting chores:** the seed list and values in section 4.7.
7. **Speech input:** Groq Whisper (`GROQ_API_KEY`).
8. **Sprites:** AI-generated pixel art from `design/baumy-reference.png`, cleaned up and approved by the owner (section 7).
9. **Calendar service account:** a new one just for this house, not camp-404's.
10. **Admin actions** (chores, weights, adjustments, pot, prize mode, members, kiosk pairing) are UI only, never exposed to the AI command, MCP or brain.
11. **No streak cap:** `multiplierPct = 100 + 25·(n−1)` forever. The break bonus cap (`breakLenCap = 10`) stays.

Still open:

- **Domain** for the app and for MCP (`MCP_PUBLIC_URL`, and later the passkey rpID).
- **Which Google Calendar** to share with the service account.
