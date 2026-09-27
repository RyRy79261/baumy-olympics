# Setup: things only the owner can do

Steps that need an account, a secret or admin rights on GitHub. Code that
depends on them is written to skip or fail closed until they are done, so CI
stays green in the meantime. Tick an item off here in the PR that finishes it.

## Owner setup checklist

Everything the owner has to do, in order, in one list. Each step links to the
section below that has the details (exact clicks, values and checks). The
sections below are the reference; this list is the order to do them in.
Do the steps top to bottom: later steps need the domain, database and
secrets from earlier ones.

### 1. Vercel: keep one project

- [ ] **Delete the duplicate Vercel project.** Two Vercel projects are
      linked to this repository and both build every push: `baumy-olympics-web`
      and `web` (see the two `Vercel – …` checks on any PR). Together they
      spend the Hobby build quota twice, which is why every overnight PR's
      Vercel checks failed with "Deployment rate limited". **Keep
      `baumy-olympics-web`** (the descriptive name); in `web` go to Settings →
      General → Delete Project (or at least Settings → Git → Disconnect).
      Then check `baumy-olympics-web` uses Root Directory `apps/web`, framework
      Next.js, no build command override, and that the Vercel–Neon
      integration's preview branching is off.
      Details: [Vercel and Neon previews](#vercel-and-neon-previews-issue-5).
- [ ] **Add the custom domain** to `baumy-olympics-web` (Settings → Domains).
      Several settings below need it (`BETTER_AUTH_URL`, `MCP_PUBLIC_URL`,
      the Google OAuth redirect, brain's `OLYMPICS_BASE_URL`), and the kiosk
      needs HTTPS.

### 2. Neon database

- [ ] **Create the Neon project** in `aws-eu-central-1` (Frankfurt); note the
      pooled and the direct connection strings.
- [ ] **On Vercel, Production:** `DATABASE_URL` = pooled,
      `DATABASE_URL_UNPOOLED` = direct.
- [ ] **On Vercel, Preview:** `PROD_DB_HOST` = the production direct host;
      leave the preview `DATABASE_URL*` unset.
      Details: [Database](#database-issue-3).

### 3. GitHub repository secrets

- [ ] **Settings → Secrets and variables → Actions:** `NEON_API_KEY`,
      `NEON_PROJECT_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID` (`team_…`) and
      `VERCEL_PROJECT_IDS` = the `prj_…` id of **`baumy-olympics-web` only**
      (not the deleted `web`).
- [ ] **Dependabot:** check its config parsed (Insights → Dependency graph →
      Dependabot) and that alerts and security updates are on; subscribe to
      better-auth's releases by hand.
      Details: [GitHub repository](#github-repository-issue-2).

### 4. Auth, founders and email (Resend, optional Google sign-in)

- [ ] **`BETTER_AUTH_SECRET`** (Production and Preview,
      `openssl rand -base64 32`) and **`BETTER_AUTH_URL`** (Production = the
      custom domain).
- [ ] **Resend account:** verify the sending domain, then set
      `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Without it nobody can reset a
      password, and founders can verify only through Google.
- [ ] **Google sign-in (optional):** OAuth client with redirect
      `<BETTER_AUTH_URL>/api/auth/callback/google`; set `GOOGLE_CLIENT_ID`
      and `GOOGLE_CLIENT_SECRET`. You need Resend **or** this so founders can
      verify their address.
- [ ] **`FOUNDER_EMAILS`** (Production): your address and your partner's,
      comma-separated.
      Details: [Auth](#auth-issue-6), [Membership](#membership-issue-9).

### 5. Vercel Blob (photo proof)

- [ ] **Create a PRIVATE Blob store** and connect it to `baumy-olympics-web`
      (Production); Vercel sets `BLOB_READ_WRITE_TOKEN`.
      Details: [Confirmations and photo proof](#confirmations-and-photo-proof-issue-15).

### 6. Daily job

- [ ] **`CRON_SECRET`** (Production, `openssl rand -hex 32`).
      Details: [Daily job](#daily-job-issue-18).

### 7. Google Calendar (house service account)

- [ ] **Pick the house calendar** (issue #30; a new calendar is simplest).
- [ ] **Create a service account for Baumy** (not camp-404's) in a Google
      Cloud project with the Calendar API on; download its JSON key.
- [ ] **Share the calendar** with the service account's `client_email`
      ("Make changes to events") and copy the calendar ID.
- [ ] **Set** `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_CLIENT_EMAIL`,
      `GOOGLE_CALENDAR_PRIVATE_KEY` (Production and Preview).
      Details: [Calendar](#calendar-issue-19).

### 8. Anthropic (Baumy command)

- [ ] **Create an API key** in a Baumy workspace on console.anthropic.com
      (consider a monthly spend limit); set `ANTHROPIC_API_KEY` (Production).
      Optionally `AI_DAILY_COMMANDS_PER_MEMBER` (default 50).
      Details: [Baumy command](#baumy-command-issue-21).

### 9. Groq (speaking to Baumy)

- [ ] **Create a Groq API key** on console.groq.com; set `GROQ_API_KEY`
      (Production).
      Details: [Speaking to Baumy](#speaking-to-baumy-issue-22).

### 10. MCP (claude.ai connector)

- [ ] **`MCP_PUBLIC_URL`** (Production) = the custom domain, never a
      `*.vercel.app` address. Without it MCP answers 503.
      Details: [MCP OAuth](#mcp-oauth-issue-23).

### 11. Optional: kiosk night hours

- [ ] **`KIOSK_NIGHT_HOURS`** only if you want other hours than
      23:00-06:30 Berlin, e.g. `22:30-07:00`.
      Details: [Kitchen iPad](#kitchen-ipad-as-an-appliance-issue-29).

### 12. `.env.example` lines agents could not write

Agents are blocked from editing `.env*` files. Add each of these lines that
is not already in `.env.example` (all are in turbo `globalEnv`; the comments
for each are in the sections below):

```sh
FOUNDER_EMAILS=
BLOB_READ_WRITE_TOKEN=
CRON_SECRET=
GOOGLE_CALENDAR_ID=
GOOGLE_CALENDAR_CLIENT_EMAIL=
GOOGLE_CALENDAR_PRIVATE_KEY=
ANTHROPIC_API_KEY=
AI_DAILY_COMMANDS_PER_MEMBER=
GROQ_API_KEY=
MCP_PUBLIC_URL=
BRAIN_BASE_URL=
KITCHEN_API_TOKEN=
KIOSK_NIGHT_HOURS=
```

In baumy-brain's `.env.example`, add `KITCHEN_API_TOKEN=`,
`BRAIN_SERVICE_TOKEN=` and `OLYMPICS_BASE_URL=` (its agents were blocked
too; the lines are in brain's SETUP.md and the PR bodies).

### 13. Deploy, then check production

- [ ] **Deploy `main`** on `baumy-olympics-web` (redeploy after setting the
      variables above). The build log shows `[migrate] VERCEL_ENV=production`,
      then `[seed] …: added 11 starter chores.` once.
- [ ] **Sign up with a founder address**, confirm the email, "Join as admin"
      on `/join`, then invite your partner from `/admin/members`. Promote a
      second admin (needed to approve point adjustments).
- [ ] **Review the starter chores** on `/admin/chores`; keep photo proof off
      "Required" until the Blob check below passes.
- [ ] **Run the per-feature checks** in the sections below: password reset
      email, photo proof, cron "Run" in Vercel, 19:00 calendar events in
      winter and summer, Baumy "who's winning?", MCP `curl` and claude.ai
      connector (`<domain>/api/mcp/mcp`, ask for `get_standings`).

### 14. baumy-brain PRs to review, merge and wire up

- [ ] **Review and merge baumy-brain PR #7** (kitchen shopping API, issue
      #25). Reviewed overnight; one test added, no bugs.
- [ ] **Shared kitchen token:** `openssl rand -hex 32`; set it as
      `KITCHEN_API_TOKEN` in brain's Vercel project (Production) **and** in
      `baumy-olympics-web` (Production and Preview), plus `BRAIN_BASE_URL` =
      brain's https production URL here. Redeploy both.
- [ ] **Mint brain's service token** from `main` against production:
      `DATABASE_URL_UNPOOLED='<direct string>' pnpm --filter @baumy/db --silent service-token mint baumy-brain`.
- [ ] **Review and merge baumy-brain PR #8** (Olympics client, `/link`,
      calendar/chore intents, issue #28). Reviewed overnight; two fixes
      pushed. Then in brain's Vercel project set `BRAIN_SERVICE_TOKEN` (the
      minted token) and `OLYMPICS_BASE_URL` (the custom domain, one that does
      not redirect), redeploy, run `scripts/set-commands.ts` and
      `pnpm test:scenarios:live`.
- [ ] **Link Telegram:** Settings → Create a link code → `/link <code>` to
      `@baumy_bot`. Then add "milk" in the Telegram group and see it on the
      kiosk within a minute.
      Details: [Shopping list](#shopping-list-issue-26),
      [Brain actions endpoint](#brain-actions-endpoint-and-telegram-linking-issue-27).

### 15. Kitchen iPad

- [ ] **Pair the iPad** (`/admin/members` → "Pair a kiosk", then
      `/kiosk/pair` on the iPad over HTTPS); each housemate sets a kiosk PIN
      in `/settings`.
- [ ] **Set it up** per [kiosk-setup.md](kiosk-setup.md) (home screen,
      Auto-Lock Never, Guided Access), run the **2-hour soak** and Lighthouse,
      note the result on issue #29, and try hold-to-speak in Safari.

### 16. Decisions only the owner can make

- [ ] Which Google Calendar is the house calendar (issue #30).
- [ ] `INVITE_CODES` (SPEC §6.8): drop it, or say what it should seed.
- [ ] Whether the December pot stays open until the season closes
      (about 2 January; SPEC §4.5).
- [ ] Whether a chore's "due" follows the measured interval (SPEC,
      UNRESOLVED, issue #17).
- [ ] Confirm: admins cannot rule on their own claims; a completion logged
      for someone else (confirmed on creation) cannot be undone (issue #12).
- [ ] Review the `display` gate that lets an idle paired kiosk read five hub
      widgets (issue #20).
- [ ] Approve the pixel art and UI kit (issue #7): every screen is a neutral
      placeholder until then.

## GitHub repository (issue #2)

- [x] **Apply the `main` ruleset.** Applied 2026-09-27 (ruleset #24056225)
      while building issue #2. Re-run after editing the JSON. Needs `gh` signed in as a repo admin and
      `jq`:

  ```sh
  ./scripts/apply-github-ruleset.sh
  ```

  It creates (or updates, when re-run) the ruleset from
  `scripts/github-ruleset.json`: PR required, `CI pass` required (from GitHub
  Actions only), merge commits only, force pushes and branch deletion blocked,
  no bypass actors. Code-owner review is **not** required (single maintainer).
  It also turns off the squash and rebase merge buttons at the repository
  level. Check afterwards with
  `gh api repos/RyRy79261/baumy-olympics/rules/branches/main`.

- [ ] **Confirm Dependabot parsed its config.** After `.github/dependabot.yml`
      reaches `main`, open Insights → Dependency graph → Dependabot and check
      that both ecosystems (npm, github-actions) show no config error. Enable
      Dependabot alerts and security updates under Settings → Code security if
      they are off.

- [ ] **Watch better-auth by hand.** It is excluded from Dependabot on
      purpose (AGENTS.md "Security"), so subscribe to its releases and security
      advisories on GitHub.

## Database (issue #3)

Nothing here blocks development: the unit tests use PGlite, and local work
and CI use Docker Postgres (`pnpm db:local:up && pnpm db:local:migrate`).
Without `DATABASE_URL` the drivers fall back to a placeholder URL, so a build
succeeds and any real query fails loudly.

- [ ] **Create the Neon project** (region `aws-eu-central-1`, Frankfurt, next
      to the household). Note both connection strings from its dashboard: the
      pooled one (host contains `-pooler`) and the direct one.
- [ ] **Set the database env vars in Vercel** (Production scope):
      `DATABASE_URL` = the pooled string, `DATABASE_URL_UNPOOLED` = the direct
      string. Never set `NEON_LOCAL_PROXY` on Vercel. Preview-scope values and
      the prod-host guard (`PROD_DB_HOST`) are under "Vercel and Neon
      previews" below.
- [ ] **Check the first production migration.** Since issue #5 every deploy
      runs `db:migrate` (`vercel-build`), so there is no manual step. After the
      first production deploy, check its build log shows
      `[migrate] VERCEL_ENV=production, target host: ep-…` and that
      `households` holds exactly one row, `Baumy household`.

## E2E (issue #4)

Nothing here needs an account: the suite runs on Docker Postgres, locally and
in the CI `e2e` job, and `CI pass` already aggregates it, so the ruleset needs
no change.

- [ ] **Never set `E2E_TEST_MODE` in any Vercel environment.** With it set,
      `next build` and `next start` refuse to run (`apps/web/lib/test-mode.ts`),
      so a stray value breaks the deploy rather than exposing the test clock.
      Check once under Project → Settings → Environment Variables when the
      Vercel project is created (issue #5).
- [ ] **After this PR merges, check the first `e2e` run on `main`** is green
      and uploads its `playwright-report` artifact.

Run it locally with:

```sh
pnpm --filter @baumy/web e2e:install   # once: Playwright Chromium
E2E_RESET_DB=1 E2E_SERVE=build ./scripts/e2e-local.sh
```

## Vercel and Neon previews (issue #5)

What each piece does, and why, is in [deploy.md](deploy.md). Until these are
done, both Neon workflows exit 0 with a notice, previews are skipped
("Ignored") because nothing marks them ready, and CI is unaffected.

- [ ] **Create the Vercel project** from this repository: Root Directory
      `apps/web`, framework Next.js. `apps/web/vercel.json` sets the build
      command (`pnpm run vercel-build`) and the ignored-build step; leave both
      unset in the dashboard. Turn **off** the Vercel–Neon integration's
      preview branching if the integration is installed.
- [ ] **Production env** (Production scope): `DATABASE_URL` and
      `DATABASE_URL_UNPOOLED` as in "Database" above.
- [ ] **Preview env** (Preview scope, no git branch):
  - `PROD_DB_HOST` = the production **direct** host, for example
    `ep-xxx.eu-central-1.aws.neon.tech`. Without it every preview's
    `db:migrate` fails closed.
  - `DATABASE_URL` / `DATABASE_URL_UNPOOLED`: leave **unset**, or point them
    at a throwaway Neon branch named `preview-default`. Never production.
  - Never `NEON_PREVIEW_READY`, `NEON_LOCAL_PROXY` or `E2E_TEST_MODE`.
- [ ] **Repository secrets** (Settings → Secrets and variables → Actions):
      `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`
      (`team_…`), `VERCEL_PROJECT_IDS` (the project's `prj_…` id).
- [ ] **Verify a normal PR.** Open a throwaway PR. Expect: the first Vercel
      deployment Ignored; the `Neon preview branch for PR` run creates
      `preview/<branch>` and logs only hosts; a new deployment whose build log
      shows `[migrate] VERCEL_ENV=preview, target host: ep-…` with a host that
      is **not** `PROD_DB_HOST`. Close it and check the cleanup run
      removes the branch and the three env rows.
- [ ] **Verify the Dependabot skip.** Push a branch named
      `dependabot/test-guard` and open a PR from it. Expect: the preview job is
      skipped, no `preview/dependabot/*` branch in Neon, and the Vercel
      deployment shows as "Ignored". Screenshot both for issue #5, then close
      the PR and delete the branch.
- [ ] **Verify the guard on Vercel** (optional; CI already proves it against
      Docker Postgres): temporarily set a branch-scoped Preview
      `DATABASE_URL_UNPOOLED` equal to the production string on a throwaway
      branch that already has `NEON_PREVIEW_READY`, redeploy, and check the
      build fails with `points at the production host`. Delete the row
      afterwards.

## Auth (issue #6)

Nothing here blocks development: locally, in CI and in e2e, Better Auth signs
with a public placeholder secret (fine off Vercel), and reset emails go to the
console or to the e2e capture file. On any Vercel environment without
`BETTER_AUTH_SECRET`, auth **fails closed**: `/api/auth/*` answers 503 and
nobody is signed in (CI checks this against the real build).

- [ ] **Generate the secret** and set `BETTER_AUTH_SECRET` in Vercel for
      Production **and** Preview (a different value per scope is fine; a
      preview's sessions then do not work on production). Use
      `openssl rand -base64 32`. Never commit it.
- [ ] **Set `BETTER_AUTH_URL`** (Production scope) to the address people
      visit, for example `https://baumy.example`. Leave it unset on Preview:
      a preview uses its own `VERCEL_URL`.
- [ ] **Resend, for password reset.** Create a Resend account, verify the
      sending domain, then set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (for
      example `Baumy Olympics <hello@your-domain>`) in Vercel. Without both,
      `/auth/forgot-password` says reset is off, and nobody can recover a
      forgotten password.
- [ ] **Google sign-in (optional).** In Google Cloud Console create an OAuth
      client (type Web application) with the authorised redirect URI
      `<BETTER_AUTH_URL>/api/auth/callback/google`, then set `GOOGLE_CLIENT_ID`
      and `GOOGLE_CLIENT_SECRET` (Production scope). The button only appears
      when both are set. Previews cannot finish a Google sign-in (Google only
      calls back registered URIs); use email and password there.
- [ ] **Never set** `AUTH_EMAIL_CAPTURE_FILE`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`
      or `AUTH_RATE_LIMIT_MAX` on Vercel. All three are ignored
      there anyway; they exist only for the e2e harness.
- [ ] **After the first production deploy**, sign up at `/auth/sign-up`,
      sign out, sign in, and request a password reset to check the email
      arrives. The deploy log should show no `[auth]` warning.

## Action registry (issue #8)

Nothing here needs an account: `runAction`, the idempotency ledger and the
audit trail are tested on PGlite and, for concurrent requests, on Docker
Postgres in the CI `db · docker postgres` job (`pnpm db:local:test`).

- [ ] **After this PR merges, check the first `db · docker postgres` run on
      `main`** lists `apps/web test:local` with its four concurrency tests
      passing.
- Kiosk PIN attestation is wired since issue #10 (see "Kiosk" below).

## Membership (issue #9)

Nothing here blocks CI: the e2e harness sets its own `FOUNDER_EMAILS` (one
per Playwright project) and reads confirmation links from the capture file.
Until `FOUNDER_EMAILS` is set on a deployment, nobody there can become the
first admin, so everyone who signs up waits on `/join`.

- [ ] **Add `FOUNDER_EMAILS` to `.env.example`** (agents cannot edit
      `.env*` files). It is already in turbo `globalEnv`:

  ```sh
  # Comma-separated. Each may join as an admin without an invite code, once
  # the address is verified (the confirmation email, or Google sign-in).
  FOUNDER_EMAILS=
  ```

- [ ] **Set `FOUNDER_EMAILS`** in Vercel (Production scope, and Preview if
      you test previews) to your address and your partner's, comma-separated.
- [ ] **Make verification possible.** A founder must confirm their address
      before `/join` lets them in as admin. That needs Resend
      (`RESEND_API_KEY` and `RESEND_FROM_EMAIL`, see "Auth" above) or
      Google sign-in (Google addresses count as verified).
- [ ] **After the first production deploy**: sign up with a founder address,
      open the confirmation email, go to `/join` and press "Join as admin".
      Then open `/admin/members`, create an invite code and check that a
      second account can redeem it.
- `INVITE_CODES` in SPEC §6.8 is not read by anything yet (marked
  UNRESOLVED there): say whether it should go, or what it should seed.

## Kiosk (issue #10)

Nothing here needs an account or a secret, and no new env var: pairing,
the device cookie and PIN attestation are tested on PGlite, on Docker
Postgres (concurrent claims and guesses) and end to end in `ipad-landscape`.

- [ ] **Serve the kiosk over HTTPS.** The `baumy_kiosk` cookie is `Secure`,
      so the iPad can pair only over HTTPS (production or a preview URL).
      `http://localhost` works for development; a dev machine reached over
      plain http on the LAN does not.
- [ ] **After the first production deploy, pair the iPad:** on your phone open
      `/admin/members` → "Pair a kiosk", name it, create the code; on the iPad
      open `/kiosk/pair` within 10 minutes and type it. Add `/kiosk` to the
      home screen. Each housemate sets a kiosk PIN in `/settings` on their own
      phone, then taps their avatar on the iPad and tries "Check my PIN".
- [ ] **Keep the iPad awake** until issue #29 adds the wake lock: Settings →
      Display & Brightness → Auto-Lock → Never, and Guided Access if you want
      it locked to the app.
      [CORRECTION 2026-09-27] issue #29 added the wake lock; the full setup
      is [kiosk-setup.md](kiosk-setup.md) (see "Kitchen iPad" below).
- If the iPad is lost, revoke it on `/admin/members` ("Revoke"); it is sent
  back to `/kiosk/pair` on its next request.

## Chores (issue #14)

Nothing here needs an account, a secret or a new env var: the chore
actions are tested on PGlite and Docker Postgres (two people tapping one
chore at once, two seeds at once) and end to end on a phone, a desktop and
the kiosk.

- [ ] **Check the starter chores after the first deploy.** `vercel-build`
      now runs `db:seed` after `db:migrate`; its build log should show
      `[seed] ep-…: added 11 starter chores.` once, and `nothing to do` on
      every later deploy. `/chores` should list the 11 chores of SPEC §4.7.
      To seed by hand instead:
      `DATABASE_URL_UNPOOLED='postgres://…' pnpm --filter @baumy/db db:seed`.
- [ ] **Review the starter values** on `/admin/chores` (points, cooldown,
      proof, confirmation, effort). Edits apply from now on; nothing already
      scored changes. Archive a chore you do not want rather than renaming it.
- [ ] **Look and feel is deferred to issue #7.** The chore tiles, the "+N"
      pop, the "STREAK BROKEN" banner and the sheet are neutral placeholders
      in `packages/ui/src/chores.tsx`; the pixel kit restyles them there.
- Photo proof arrived with issue #15 (see "Confirmations and photo proof"
  below): a chore set to "Photo proof: Required" can be logged only with a
  photo, and only once Blob is configured.

## Confirmations and photo proof (issue #15)

Confirm, dispute, undo, withdraw, concede and the admin ruling need nothing:
they are tested on PGlite, on Docker Postgres (a confirm and a dispute
racing) and end to end (E9 on the phone with the server clock moved, and
the kiosk banner with a PIN). Photos need a Vercel Blob store. Until it
exists, uploads answer "Photo uploads aren't set up on this deployment yet."
and store nothing, so a chore with "Photo proof: Required" cannot be logged.
E2E and CI use an in-memory fake (`E2E_TEST_MODE=1`), so CI stays green
without it.

- [ ] **Create a PRIVATE Blob store** in Vercel (Storage → Blob → Create,
      access "Private") and connect it to the project for Production (and
      Preview if you test photos there). Vercel then sets
      `BLOB_READ_WRITE_TOKEN` on the project.
- [ ] **Add `BLOB_READ_WRITE_TOKEN` to `.env.example`** (agents cannot edit
      `.env*` files). It is already in turbo `globalEnv`:

  ```sh
  # Vercel Blob read-write token of a PRIVATE store. Completion photos are
  # served only through /api/blob; without it, photo uploads answer 501.
  BLOB_READ_WRITE_TOKEN=
  ```

- [ ] **For local photo uploads outside e2e**, put the token in
      `apps/web/.env.local` (never commit it).
- [ ] **After the deploy, try it:** set a chore's photo proof to Optional on
      `/admin/chores`, log it with a photo on `/chores`, and open
      `/inbox`: the claim shows the photo. Opening that photo's
      `/api/blob?pathname=…` link in a private window must answer 401.
- The daily job (issue #18) deletes a photo 90 days after its claim
  settled; without a Blob store it leaves them alone. A file whose action
  was refused is deleted at once by the upload route.

## Scoreboard and pot (issue #16)

Nothing here needs an account, a secret or a new env var: the actions are
tested on PGlite and Docker Postgres (setting the prize mode while a chore
is being logged) and end to end on a phone and a desktop.

- [ ] **Promote a second admin** on `/admin/members` if you want to use
      point adjustments: an adjustment counts only once an admin other than
      the one who proposed it approves it on `/scores`.
- [ ] **Check the prize mode** on `/scores`: v1 plays only "Points: winner
      takes the whole pot". This season's mode is fixed at its first
      completion; next year's can be set any time.
- [ ] **Record the pot** on `/pot` each month (admins only). It is a
      ledger: the money moves at the bank.
- [ ] **Look and feel is deferred to issue #7.** The table, the dimmed
      points, the streak flame and the big numbers are neutral placeholders
      in `packages/ui/src/scores.tsx`.
- The daily job (issue #18) closes the season and writes the winner; the
  kiosk's leaderboard widget is on the kiosk home (issue #20).

## Weights (issue #17)

Nothing here needs an account, a secret or a new env var: the formula is
unit and property tested, the weekly compute and the apply on PGlite and
Docker Postgres (two computes at once, a veto racing the apply, two applies
at once), and the schedule-then-veto flow end to end.

- [ ] **Suggestions appear on Mondays (Berlin)**, once the daily job runs
      (issue #18, below): it calls `computeSuggestions` and
      `applyDueSuggestions`. In e2e, the test-only `POST /api/test/weights`
      runs them on any day (404 outside `E2E_TEST_MODE=1`).
- [ ] **Decide the weight changes together.** A change one admin schedules
      shows on `/inbox` ("Point changes coming") for everyone else to veto
      until it applies, at the first Monday 00:00 Berlin at least 48h away
      and at least 28 days after the chore's last change.
- [ ] **Look and feel is deferred to issue #7.** The sparkline is a neutral
      placeholder in `packages/ui/src/sparkline.tsx`.

## Daily job (issue #18)

`GET /api/cron/daily` runs at 02:00 UTC (`apps/web/vercel.json`) and does
what the reads already derive from the clock: it persists finalized, expired
and timed-out claims, closes last season and writes its winner, computes and
applies weight suggestions on Berlin Mondays, and deletes proof photos 90
days after their claim settled. Nothing depends on it having run: hub and
kiosk page loads run the same sweep at most every 15 minutes. It is tested
on PGlite and Docker Postgres (overlapping runs), so CI needs no secret.

- [ ] **Set `CRON_SECRET`** on the Vercel project (Production; Preview only
      if you want previews to run it), a random string of at least 16
      characters, e.g. `openssl rand -hex 32`. Vercel sends it as
      `Authorization: Bearer …` to the cron. Without it the route answers 503
      and does nothing (the page-load sweep still runs).
- [ ] **Add `CRON_SECRET` to `.env.example`** (agents cannot edit `.env*`
      files). It is already in turbo `globalEnv`:

  ```sh
  # Shared secret for GET /api/cron/daily (Vercel sends it as a Bearer token).
  # Without it the daily cron answers 503; the page-load sweep still runs.
  CRON_SECRET=
  ```

- [ ] **After the deploy, check it:** Vercel → Project → Settings → Cron Jobs
      lists `/api/cron/daily`; "Run" it once and the log shows each step
      (`settle`, `seasons`, `weights`, `photos`) with `ok: true`. Hobby runs
      it once a day, sometime within the 02:00 UTC hour.
- [ ] **Decide the December pot** ([UNRESOLVED] in SPEC §4.5): money for
      last season can be recorded until the job closes it, about 2 January.
- A season with a disputed claim that has a photo stays `closing` until an
  admin rules on it on `/inbox`; then the next run writes the winner.

## Calendar (issue #19)

`/calendar` (and `/kiosk/calendar`) shows the house's Google Calendar in
Day, Week and Month views, and adds, edits and deletes events through the
`list_events`, `create_event`, `update_event` and `delete_event` actions. The
client is `apps/web/lib/integrations/google-calendar.ts` (no SDK: a
hand-signed service-account JWT). Without the three settings below the page
says "Not connected yet" instead of failing, and the actions answer
`NOT_CONFIGURED`. CI and e2e need no account: they use the in-memory fake
(`lib/integrations/calendar-memory.ts`) under `E2E_TEST_MODE=1`.

- [ ] **Decide which Google Calendar is the house calendar** (still open,
      SPEC §12, #30). A new calendar made for the house is simplest.
- [ ] **Make a new service account for this house** (SPEC §12 decision 9:
      not camp-404's). Google Cloud Console → a project for Baumy → APIs &
      Services → enable the **Google Calendar API** → IAM & Admin → Service
      accounts → Create (no roles needed) → Keys → Add key → JSON. Keep the
      JSON file out of the repo.
- [ ] **Share the calendar with the service account:** Google Calendar →
      the calendar's Settings and sharing → Share with specific people → the
      service account's `client_email` → **Make changes to events**. Copy the
      calendar's ID from "Integrate calendar" on the same page.
- [ ] **Set the three variables** on the Vercel project (Production and
      Preview): `GOOGLE_CALENDAR_ID` (the calendar ID),
      `GOOGLE_CALENDAR_CLIENT_EMAIL` (`client_email` from the JSON) and
      `GOOGLE_CALENDAR_PRIVATE_KEY` (`private_key` from the JSON, pasted as
      is: the `\n` escapes are turned back into newlines). They are already
      in turbo `globalEnv`.
- [ ] **Add them to `.env.example`** (agents cannot edit `.env*` files):

  ```sh
  # The house's Google Calendar (SPEC §6.4), shared with a service account
  # made for this house ("Make changes to events"). Without all three the
  # calendar page says "Not connected yet".
  GOOGLE_CALENDAR_ID=
  GOOGLE_CALENDAR_CLIENT_EMAIL=
  # The JSON key's private_key, with its \n escapes, in double quotes.
  GOOGLE_CALENDAR_PRIVATE_KEY=
  ```

- [ ] **After the deploy, check it:** add an event at 19:00 on `/calendar`
      for a day in winter and one in summer; both must show at 19:00 in
      Google Calendar (the app sends Berlin wall time with
      `timeZone: Europe/Berlin`, never a fixed offset). A failure is logged
      as `[calendar] <op> failed: HTTP <status>`; 403 or 404 means the
      calendar is not shared with the service account, or the ID is wrong.
- Private and confidential events are hidden everywhere and cannot be
  changed from the app. Olympics keeps no copy of the events, only the
  audit rows of its own changes.
- [ ] **Look and feel is deferred to issue #7.** The grid, the day cells and
      the event buttons are neutral placeholders in
      `packages/ui/src/calendar.tsx`.

## Hub and notes (issue #20)

Nothing here needs an account, a secret or a new env var. The notes table
comes with migration `0007_notes.sql`, applied by `db:migrate` on deploy.

- [ ] **Look and feel is deferred to issue #7.** The widgets, the sticky
      notes, the clock and the Baumy button are neutral placeholders in
      `packages/ui/src/hub.tsx` and `packages/ui/src/note.tsx`; the note
      colours are names (`NOTE_COLORS`) for the palette to map.
- The "Today" widget says the calendar is not connected until the Google
  Calendar settings above are set; the rest of the hub works without them.
- The shopping widget is an empty slot until issue #26, and the Baumy
  button opens a placeholder until the AI command (issues #21, #22).
  [CORRECTION 2026-09-27] issue #26: the widget is brain's shopping list;
  see "Shopping list" below.
- On the kiosk, adding or changing a note asks for the member's kiosk PIN:
  each member sets theirs in `/settings` on their own phone.

## Baumy command (issue #21)

Typing to Baumy (the button on the hub and the kiosk) sends the text to
Claude with the registry's `ai` tools. Reads are answered in the speech
bubble; writes come back as proposals that a member approves. Without
`ANTHROPIC_API_KEY` the sheet says Baumy isn't connected yet and nothing
else changes. CI and e2e need no key: they use the scripted fake
(`lib/integrations/claude-fake.ts`) under `E2E_TEST_MODE=1`. The
`ai_usage` table comes with migration `0008_ai_usage.sql`.

- [ ] **Create an Anthropic API key** for this app: console.anthropic.com →
      a workspace for Baumy → API keys → Create key. Consider a monthly
      spend limit on the workspace (Settings → Limits).
- [ ] **Set `ANTHROPIC_API_KEY`** on the Vercel project (Production; Preview
      only if you want previews to call Claude). Already in turbo
      `globalEnv`. A refused key shows "An admin needs to check the
      ANTHROPIC_API_KEY setting" and logs `[ai:command] failed`.
- [ ] **Optionally set `AI_DAILY_COMMANDS_PER_MEMBER`** (default 50 per
      member per Berlin day; `0` switches the command off). Already in turbo
      `globalEnv`.
- [ ] **Add both to `.env.example`** (agents cannot edit `.env*` files):

  ```sh
  # Claude for the Baumy command (SPEC §3.6). Without it the sheet says
  # Baumy isn't connected yet; e2e uses a scripted fake instead.
  ANTHROPIC_API_KEY=
  # Baumy commands per member per Berlin day (default 50; 0 turns it off).
  AI_DAILY_COMMANDS_PER_MEMBER=
  ```

- [ ] **After the deploy, check it:** ask Baumy "who's winning?" on your
      phone (an answer, no proposal), then "I took the trash out" (a
      "Log Trash for …" proposal; approve it and `/scores` shows it). Each
      command adds one `ai_usage` row with its tokens.
- The model is Claude Sonnet 5 (`packages/ai-prompts/src/models.ts`,
  `COMMAND_TIER`); change the tier there if you want another.
- [ ] **Look and feel is deferred to issue #7.** The speech bubble and the
      proposal rows are neutral placeholders in `packages/ui/src/baumy.tsx`;
      Baumy's sprite states are wired (issue #22) to a placeholder tile.

## Speaking to Baumy (issue #22)

Holding the microphone button in the Baumy sheet records a clip, Groq
Whisper (`whisper-large-v3-turbo`) turns it into text, and the text goes to
Baumy as if typed. Without `GROQ_API_KEY` the microphone button is not
shown and typing works as before. CI and e2e need no key: under
`E2E_TEST_MODE=1` a fake transcriber hears "Who's winning?" in every clip.
No migration: `ai_usage.audio_seconds` came with `0008_ai_usage.sql`.

- [ ] **Create a Groq API key:** console.groq.com → API Keys → Create API
      Key (name it for Baumy). Groq bills transcription per audio hour; a
      clip is at most a minute, and each member can send 30 per 10 minutes.
- [ ] **Set `GROQ_API_KEY`** on the Vercel project (Production; Preview
      only if you want previews to transcribe). Already in turbo
      `globalEnv`. A refused key shows "An admin needs to check the
      GROQ_API_KEY setting" and logs `[ai:transcribe] failed invalid_key`.
- [ ] **Add it to `.env.example`** (agents cannot edit `.env*` files):

  ```sh
  # Groq Whisper for speaking to Baumy (SPEC §3.6). Without it the
  # microphone button is hidden; e2e uses a fake transcriber instead.
  GROQ_API_KEY=
  ```

- [ ] **After the deploy, check it on the kitchen iPad (Safari):** tap your
      avatar, open Baumy, hold "Hold to speak", say "who's winning?" and let
      go. Safari asks for the microphone the first time (the hold then turns
      into "Tap to send"); allow it. The sheet shows "You said: …" and
      Baumy's answer, and one `groq` row lands in `ai_usage` with its
      `audio_seconds`. If you deny the microphone, the sheet says so and
      the text box takes over; allow it again in Settings → Safari →
      Microphone.
- The Whisper prompt is the members' names, the chores' names and a few
  German place words (`packages/ai-prompts/src/transcribe.ts`); add words
  there if Whisper keeps mishearing one.
- [ ] **Look and feel is deferred to issue #7.** Baumy's seven states
      (`idle`, `listening`, `thinking`, `talking`, `happy`, `sad`,
      `sleeping`) drive a placeholder tile (`packages/ui/src/sprite.tsx`,
      `SPRITE_MOTION`); the drawn sprite sheet from
      `design/baumy-reference.png` replaces it there. The microphone button
      and level meter are `packages/ui/src/voice.tsx`.

## MCP OAuth (issue #23)

Chatbots (claude.ai's custom connectors, Claude Desktop, Claude Code) get a
token for one member through Baumy's own OAuth server: they register
themselves, the member approves them on `/oauth/consent` (ticking read, and
write if wanted), and `/settings/connections` lists and disconnects them.
The MCP endpoint that uses the token is issue #24. No outside account or
key is needed; the tables come with migration `0009_mcp_oauth.sql`. CI and
e2e need nothing: off Vercel the issuer is the request's own address.

- [ ] **Set `MCP_PUBLIC_URL`** on the Vercel project (Production) to the
      address people use, for example `https://baumy.example.com` (the
      custom domain, never the `*.vercel.app` deployment address, which is
      behind Vercel's login). Without it every `/api/mcp/oauth/*` and
      `/.well-known/oauth-*` answer is 503 "MCP is not configured". Set it
      on Preview only if you want to connect a preview (its own address).
      Already in turbo `globalEnv`.
- [ ] **Add it to `.env.example`** (agents cannot edit `.env*` files):

  ```sh
  # The OAuth issuer for MCP connectors (SPEC §6.3): the public address,
  # never VERCEL_URL. Unset on Vercel, MCP answers 503; unset locally, the
  # request's own address is used.
  MCP_PUBLIC_URL=
  ```

- [ ] **After the deploy, check it:**
      `curl https://<your-domain>/.well-known/oauth-authorization-server`
      shows `"issuer": "https://<your-domain>"` and
      `"code_challenge_methods_supported": ["S256"]`.
- If a firewall or Cloudflare sits in front of Vercel, let
  `/.well-known/oauth-*` and `/api/mcp/*` through: claude.ai's probes look
  like bots (intake-tracker's gotcha #10).

- [ ] **Look and feel is deferred to issue #7.** The consent page
      (`app/oauth/consent/page.tsx`) and `/settings/connections` use the
      neutral `packages/ui` placeholders, including the new `Checkbox`.

### The MCP endpoint (issue #24)

The connector URL is `<MCP_PUBLIC_URL>/api/mcp/mcp` (the doubled `mcp` is
right: mcp-handler's base path plus its transport). It needs nothing beyond
`MCP_PUBLIC_URL` above: no Redis (SSE is off), no new variable. CI and e2e
drive it with a scripted client (`apps/web/e2e/specs/mcp-server.spec.ts`).

- [ ] **Check it answers:** `curl -i -X POST https://<your-domain>/api/mcp/mcp`
      is a 401 whose `WWW-Authenticate` names
      `resource_metadata="https://<your-domain>/.well-known/oauth-protected-resource"`.
- [ ] **Connect claude.ai** (Pro, Max, Team or Enterprise): Settings →
      Connectors → Add custom connector → paste
      `https://<your-domain>/api/mcp/mcp` → Connect. Sign in to Baumy if
      asked, tick "Make changes as you (baumy:write)" only if Claude should
      log chores, and Approve. In a new chat ask "What are the Baumy
      standings?": Claude should call `get_standings`.
- [ ] **Check the write path** (only with baumy:write): ask Claude to log a
      chore; approve the tool call in claude.ai; the chore shows on
      `/chores`, and its audit row has `source = mcp`.
- [ ] **Check revoking:** disconnect it on `/settings/connections`; Claude's
      next tool call fails and it asks to reconnect.

## Shopping list (issue #26)

The hub widget, `/shopping` and `/kiosk/shopping` show baumy-brain's house
shopping list through brain's kitchen API (baumy-brain PR
RyRy79261/baumy-brain#7, issue #25). Without the two variables below the
widget says the list is not connected yet and the rest of the hub works. CI
and e2e need neither: under `E2E_TEST_MODE=1` an in-memory brain stands in
(`apps/web/lib/integrations/brain-memory.ts`), and `/api/test/brain` plays the
Telegram group. No migration.

- [ ] **Merge and deploy the brain side first** (baumy-brain PR #7), and add
      Baumy to the house Telegram group: until then brain answers
      503 `not_configured` and the widget says the list is not connected.
- [ ] **Make one token and give it to both apps:** `openssl rand -hex 32`.
      In baumy-brain's Vercel project set `KITCHEN_API_TOKEN` to it
      (Production) and redeploy.
- [ ] **In this app's Vercel project** (Production and Preview) set
      `BRAIN_BASE_URL` to brain's production URL, for example
      `https://baumy-brain.vercel.app` (no trailing path), and
      `KITCHEN_API_TOKEN` to the same token.
- [ ] **Add these lines to `.env.example`** by hand (agents cannot edit
      `.env*` files); both are already in turbo `globalEnv`:

      ```
      # baumy-brain's kitchen shopping API (issue #26). Both unset: the
      # shopping list says it is not connected.
      BRAIN_BASE_URL=
      KITCHEN_API_TOKEN=
      ```

- [ ] **After the deploy, check it:** add "milk" in the Telegram group; the
      kitchen screen shows it within a minute (its 60s re-read skips the 30s
      cache). Tick it off on the kiosk; it is gone when you ask Baumy for
      the list in Telegram. A failure is logged as
      `[brain] <op> failed: HTTP <status>`; 401 means the two
      `KITCHEN_API_TOKEN`s differ.
- Kitchen writes reach brain with no author for now (brain records
  `added_by` as null). Members can link Telegram since issue #27; sending
  their Telegram id with kitchen writes is a follow-up.
- [ ] **Look and feel is deferred to issue #7.** The tap-to-check rows are
      neutral placeholders in `packages/ui/src/check-list.tsx`.

## Brain actions endpoint and Telegram linking (issue #27)

`/api/v1/actions` lets baumy-brain run Olympics actions for a linked
Telegram user; the contract is [brain-integration.md](brain-integration.md).
Migration `0010_service_tokens` runs on deploy. No new env var in this app:
it keeps only the token's hash, in the database. Until a token is minted
every call answers 401, so nothing is exposed. CI and e2e mint their own
tokens against Docker Postgres.

- [ ] **Mint brain's token against production**, from a checkout of `main`
      after this PR deploys, with the direct (unpooled) Neon string:

      ```sh
      DATABASE_URL_UNPOOLED='<direct production string>' \
        pnpm --filter @baumy/db --silent service-token mint baumy-brain
      ```

      It prints the token once (stderr names the host). Nothing else keeps
      it.

- [ ] **In baumy-brain's Vercel project** (Production) set
      `BRAIN_SERVICE_TOKEN` to that token and `OLYMPICS_BASE_URL` to this
      app's production URL (the names issue #28 gives brain's client), then
      redeploy brain once that client exists.
- [ ] **Link your own Telegram account** once brain is deployed: Settings →
      Create a link code, then send `/link <code>` to `@baumy_bot`. Or, as an
      admin, type a member's Telegram user id on `/admin/members`.
- [ ] **Check it** with a curl from your machine (the example at the end of
      brain-integration.md): with `X-Baumy-Confirmed: 1` the event appears on
      `/calendar`; without it the answer is 428 `CONFIRMATION_REQUIRED`.
- To rotate the token, run `service-token rotate baumy-brain` (the old one
  stops at once), then update brain's env.
- To cut brain off, run `service-token revoke baumy-brain`.

## Kitchen iPad as an appliance (issue #29)

The manifest, icons, wake lock, idle reset, night mode and offline page need
no account and no secret. One optional env var; the rest is on the iPad
itself, in [kiosk-setup.md](kiosk-setup.md).

- [ ] **Add the night-mode line to `.env.example`** (agents cannot edit
      `.env*` files; it is already in turbo `globalEnv`):

      ```sh
      # Kiosk night mode (issue #29): Berlin wall time "HH:MM-HH:MM", or "off".
      # Unset = 23:00-06:30. A value that does not parse falls back to it.
      KIOSK_NIGHT_HOURS=
      ```

- [ ] **Only if you want other hours**, set `KIOSK_NIGHT_HOURS` in Vercel
      (Production), for example `22:30-07:00`, and redeploy. Under
      `E2E_TEST_MODE=1` night mode is off unless a spec's browser carries the
      `baumy_e2e_night` cookie.
- [ ] **Set up the iPad** as [kiosk-setup.md](kiosk-setup.md) says: add
      `/kiosk` to the home screen, Auto-Lock Never, Low Power Mode off,
      Guided Access with its own Display Auto-Lock set to Never.
- [ ] **Run the checks** at the end of kiosk-setup.md on the real iPad,
      including the **2-hour soak test**, and note the result on issue #29
      (the PR could not: no iPad in CI).
- [ ] **Approve the pixel art.** The app icon (`components/app-icon.tsx`),
      the night screen's sleeping Baumy and every sprite are placeholders:
      the final sheets, AI-generated from `design/baumy-reference.png` and
      cleaned up by hand, need your approval before they ship (issue #7).
