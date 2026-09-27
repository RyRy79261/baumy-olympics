# AGENTS.md: how we work on Baumy Olympics

Read `docs/SPEC.md` and `docs/decisions/` before changing behaviour. If this file and the code disagree, fix one of them in the same PR.

## Workspace

```
apps/web            Next.js 16 app (hub, kiosk, API, MCP, AI command)
packages/core       pure domain logic (scoring). No I/O, no Date.now(), no randomness.
packages/db         Drizzle schema + migrations + per-domain queries + PGlite test harness
packages/auth       Better Auth config (pinned 1.6.25)
packages/ui         UI kit + sprites (neutral placeholders until issue #7 restyles them)
packages/types      Zod schemas shared across boundaries
packages/ai-prompts system prompts + model tiers (no SDK imports)
```

## Commands

| Command                                                 | What it does                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm i`                                                | Install dependencies. Uses pnpm 10 (`packageManager`) and Node 22 or later. |
| `pnpm dev`                                              | Start the web app on :3000.                                                 |
| `pnpm db:local:up`, then `pnpm db:local:migrate`        | Start Docker Postgres and the Neon proxies, then migrate.                   |
| `pnpm db:local:seed`                                    | Add the SPEC §4.7 starter chores, if the household has no chores yet.       |
| `pnpm db:local:test`                                    | Run the `*.local.test.ts` files (db, web) that need Docker Postgres.        |
| `pnpm --filter @baumy/db db:generate`                   | Generate a migration after editing `schema.ts`.                             |
| `pnpm turbo run format:check lint typecheck test build` | **The gate.** Run it before every push.                                     |
| `E2E_SERVE=build ./scripts/e2e-local.sh [specs/<area>]` | Run Playwright against Docker Postgres.                                     |
| `for t in scripts/tests/*.test.sh; do bash "$t"; done`  | Test the deploy scripts (docs/deploy.md).                                   |

## Git and PRs

- **Never commit to `main`.** Create a branch named `<type>/<short-desc>` (for example `feat/chore-logging`) and open it with `gh pr create`.
  - One issue per PR, with `Closes #N` in the body.
  - The only required check is `CI pass`. Vercel checks are not required. A `main` ruleset enforces this: PR required, merge commits only, no force pushes.
- **Conventional Commits** are enforced by commitlint, through the husky `commit-msg` hook and a CI job that checks the PR title and every commit.
  - Scopes: `web`, `kiosk`, `core`, `db`, `auth`, `ui`, `types`, `ai`, `mcp`, `brain`, `calendar`, `e2e`, `ci`, `repo`.
  - The header is lowercase, imperative, has no full stop, and is at most 72 characters.
- PRs are **merged, not squashed**, so every commit message matters.
- The PR template leads with **Why / Decisions / Database** ("None." is a valid answer), then Testing (the gate and the e2e areas you ran), Risk and Follow-ups. Keep the body short and put anything long in a `<details>` fold.
- Do not add new tooling layers, skills or services without asking Ryan.

## Tests are required

- Every behaviour change ships with tests in the same PR.
  - Scoring changes need unit and property tests (fast-check).
  - Each action needs `execute` tests for success, each error code, the surface rules and the permission rules.
  - Each user-visible flow needs a Playwright spec.
- **A test that cannot fail proves nothing.** Break the code, watch the test go red, then restore the code.
- Assert that something is present before you assert that something is absent.
- Seed fixtures from the constants the code uses (for example `RULESET_V1`), not from copied numbers.
- Coverage floors live in each workspace's `vitest.config.ts` and **only go up**:
  - core: 95%, and 100% for `scoring/*`;
  - auth: 95%;
  - db: 75%;
  - web `lib/**`: 90%.
- E2E runs against Docker Postgres, never against production. External services are faked when `E2E_TEST_MODE=1`, and the app refuses to boot with that flag set on Vercel.
  - Specs live in `apps/web/e2e/specs/`; the config (`apps/web/playwright.config.ts`) refuses any non-localhost `E2E_BASE_URL`.
  - First run: `pnpm --filter @baumy/web e2e:install` for Chromium.
  - To move server time, use `advanceClock(page, ms)` from `apps/web/e2e/lib/clock.ts`; `page.clock` only moves the browser. The offset is shared by the whole server, so such specs run serially in `desktop-chromium` only (add them to `SHARED_CLOCK_SPECS` in `playwright.config.ts`).

## Database rules

- `packages/db/src/schema.ts` is the only source of truth.
- Migrations are **generated only, append-only, and never edited or renamed**. If your migration collides with another after a rebase, delete _your_ migration and regenerate it.
- Data fixes are custom migrations (`db:generate --custom --name x`). They must be idempotent and tested on PGlite.
- CI fails if `drizzle-kit generate` produces a diff.
- **Pick the right driver:** `createHttpDb()` has no transactions, so use it for reads only. Use `withTransaction()` (the pooled driver) for any multi-statement write.
- **Completion writes** lock the chore row (`FOR UPDATE`), then validate, insert, re-score and audit, all in one transaction.
- Postgres traps:
  - a nullable column inside a unique index;
  - `ON CONFLICT` against a partial unique index needs `targetWhere`.
- Migrations run on deploy (`vercel-build`: `db:migrate && db:seed && next build`). On previews the migrate wrapper refuses to run against the prod host (ADR 0004), and so does `db:seed`, which adds the starter chores only while the household has none.

## Code conventions

- **Every capability is an action** in `apps/web/lib/actions/` (ADR 0002).
  - UI server actions, the AI command, MCP and the brain endpoint all call `runAction`. Never call domain writes directly from a route or component.
  - `runAction` alone writes `audit_events` and `action_requests`. Domain functions take the caller's `tx` and write neither. The one audit row written outside `execute` is the kiosk PIN lock, by runAction's attestation step (`lib/auth/pin.ts`).
  - Declare an action with `defineAction` (`lib/actions/define.ts`), add its name to `ACTION_NAMES` and its entry to `lib/actions/registry.ts`. A write's `execute` returns `audit: {entity, entityId}`; returning `{ok: false}` rolls the whole transaction back.
  - A note's markdown is rendered only through `MarkdownBody` (`packages/ui`), the sanitising renderer; never `dangerouslySetInnerHTML`.
  - Server actions call `actionForm(name, formData)` (`lib/actions/ui.ts`); the form carries a hidden `requestId`. Client forms get it from `useActionForm` (`components/use-action-form.ts`).
  - A proof photo never arrives as action input: `app/api/uploads/completion-photo` stores the file, then runs `log_completion` or `attach_completion_photo` with the stored pathname in `RequestCtx.photo` (`lib/photos/upload.ts`). Photos are shown only through `/api/blob` (`photoProxyUrl`).
  - An input holding a secret (a PIN, a password) sets `fingerprint` so neither `input_hash` nor the audit payload sees it; a result holding a one-time code sets `storedData` so the ledger never stores it.
  - Actions that call Google or brain set `transactional: false`; never hold a transaction across a network call.
  - Admin-only actions have `surfaces: ["ui"]`.
- **Kiosk:** kiosk pages and server actions use `getKioskActor()` and `kioskActionForm(name, formData)` (`lib/actions/kiosk.ts`, surface `kiosk`); a form that needs attestation wraps itself in `AttestedForm` (`components/kiosk/attested-form.tsx`), which opens the `PinPad` and sends the PIN with that one request.
- **AI command** (`lib/ai/`): read tools run in the loop through `runAction` (source `ai`); a write is only ever turned into a proposal by `proposeAction` (checked and previewed, never executed), and runs when a member approves it through `POST /api/actions/run` with the proposal id as `requestId`. Claude sits behind `lib/integrations/claude.ts` (the scripted fake under `E2E_TEST_MODE=1`); model ids live in `packages/ai-prompts`, never inline. Speech goes through `POST /api/ai/transcribe` (`lib/ai/transcribe.ts`) and `lib/integrations/groq.ts` (the fake under `E2E_TEST_MODE=1`); the sheet offers the microphone only when `voiceConfigured()`. Baumy's sprite state comes from `lib/ai/mood.ts`, never set by hand.
- **Authorization:** one gate function per concern (`requireMember`, `requireDisplay` for the reads the idle kitchen screen shows, `requireAdmin`, `requireAttested`, `requireSession`, and `requireAccount` for the joining actions only). Never hand-roll a check at a call site. Kiosk actors never pass `requireSession`, `requireAccount` or `requireAdmin`.
  - Pages use the page gate ladder (`lib/auth/page-gate.ts`): `requireMemberPage()` (no session → sign-in, no member row → `/join`), `requireAdminPage()` (non-admins get a 404) and `requireJoiningPage()`.
- **Writes:**
  - Privileged writes add an `audit_events` row in the **same transaction** as the change.
  - Decision writes are compare-and-set (`WHERE status = $expected … RETURNING`). A lost race returns a sentence the user can act on.
  - Every write takes a `requestId` for idempotency.
- **Validate with Zod at every boundary.** Shared schemas live in `packages/types`.
- A `"use server"` file exports only async functions.
- **Integrations** (Google Calendar, brain, Groq, Claude) return result unions (`ok`, `not_configured`, `unavailable`) and never throw into the UI. Errors carry the HTTP status only, and secrets are passed through `redactSecrets`.
- **Time:** read the current time from `lib/clock.ts` (never `new Date()` in server code). All times are stored as UTC timestamptz. Anything about days or seasons uses Europe/Berlin through `packages/core/src/time.ts`. Never hard-code `+01:00` or `+02:00`.
- **No cron beyond the single daily job.** Other work runs in `after()` or lazily on page load behind a rate-limit row, and must be idempotent and safe against double claims (`FOR UPDATE SKIP LOCKED`).
- **Env vars:** every new variable goes into both `.env.example` and turbo `globalEnv` in the same PR.
- **UI:**
  - Pages start with `PageHeading`. Do not add `loading.tsx` files.
  - Form errors show inline; one-tap actions report through a toast.
  - Kiosk touch targets are at least 56px, with no hover-only affordances.

## Security

- Auth fails closed without `BETTER_AUTH_SECRET`. `changeEmail` stays off. Keep sign-in and forgot-password enumeration-safe.
- Store tokens (kiosk, service, MCP, bearer) only as hashes, and compare them in constant time.
- The in-app AI never runs a write without a human approving it; brain confirms `confirm`-risk writes with an inline button (SPEC §9). Destructive actions are never exposed over MCP or to brain.
- Cookie-authenticated POST route handlers check `Origin`/`Sec-Fetch-Site`.
- Blob is private and served only through the `/api/blob` proxy. SVG uploads are not allowed.
- better-auth is pinned and excluded from Dependabot, so watch its CVEs by hand.

## Verification and honesty

- Measure before you claim, and attribute a failure before you blame something for it.
- If you change behaviour, fix the doc in the same PR, or mark the doc `[CORRECTION yyyy-mm-dd]` or `[UNRESOLVED yyyy-mm-dd]`.
- Owner rulings go into `docs/decisions/` or SPEC §12 (decisions and open questions), dated.

## Reference repos (copy patterns, cite the path in the PR)

- camp-404: `/home/ryan/repos/Personal/camp-404` (on `main`)
- afrikaburn: `/home/ryan/repos/Personal/afrikaburn-contributors-app`. Read it with `git show origin/main:<path>`, because the local branch is stale.
- intake-tracker: `/home/ryan/repos/Personal/intake-tracker`
- baumy-brain: `/home/ryan/repos/Personal/baumy-brain`, the live Telegram bot `@baumy_bot`. Not `baumy-bot`, which is an unrelated ROS2 robot prototype.
