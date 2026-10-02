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
      integration's preview branching is **on** ([CORRECTION 2026-09-29]
      this said "off" while our own workflow made the branches; issue #99).
      Details: [Vercel and Neon previews](#vercel-and-neon-previews-issue-5).
      [CORRECTION 2026-09-29] Preview deployments are now off
      (`git.deploymentEnabled` in `apps/web/vercel.json`, issue #101): only
      `main` deploys, so the integration makes no preview branches. Leave its
      preview branching on; it is idle and ready if previews come back.
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
      leave the unscoped preview `DATABASE_URL*` unset (the Neon integration
      writes each preview's own).
      Details: [Database](#database-issue-3).

### 3. GitHub repository secrets

- [ ] **Settings → Secrets and variables → Actions:** `NEON_API_KEY` and
      `NEON_PROJECT_ID`, for the cleanup workflow that deletes each closed
      PR's Neon branch. `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
      `VERCEL_PROJECT_IDS` are no longer used (issue #99) and can be deleted.
- [ ] **Dependabot:** check its config parsed (Insights → Dependency graph →
      Dependabot) and that alerts and security updates are on; subscribe to
      better-auth's releases by hand.
      Details: [GitHub repository](#github-repository-issue-2).

### 4. Auth, founders and email (Resend, optional Google sign-in)

- [ ] **`BETTER_AUTH_SECRET`** (Production and Preview,
      `openssl rand -base64 32`) and **`BETTER_AUTH_URL`** (Production =
      `https://www.baumy.tech`; the apex `baumy.tech` redirects to it), plus
      **`PASSKEY_RP_ID=baumy.tech`** (Production). Passkeys are bound to
      `baumy.tech` for life, so set both before anyone adds one.
      Details: [Passkeys, two-factor and devices](#passkeys-two-factor-and-devices-issue-79).
- [ ] **Resend account:** verify the sending domain, then set
      `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Without it nobody can reset a
      password, and founders can verify only by signing up with Google.
- [ ] **Google sign-in (optional):** OAuth client with JavaScript origin
      `https://www.baumy.tech` and redirect
      `https://www.baumy.tech/api/auth/callback/google` (the same URI serves
      "Link Google" on Settings, Security); set `GOOGLE_CLIENT_ID`
      and `GOOGLE_CLIENT_SECRET`. You need Resend **or** this so founders can
      verify their address. Without Resend, a founder must **sign up with
      Continue with Google**: since issue #79 Google never joins an existing
      password account by itself (only "Link Google" on Settings, Security
      does), so a founder who signed up with a password first cannot verify
      through Google.
- [ ] **`FOUNDER_EMAILS`** (Production): your address and your partner's,
      comma-separated.
      Details: [Auth](#auth-issue-6), [Membership](#membership-issue-9).

### 5. Vercel Blob (photo proof)

- [ ] **Create a PRIVATE Blob store in Frankfurt (`fra1`)** and connect it to `baumy-olympics-web`
      (Production); Vercel sets `BLOB_READ_WRITE_TOKEN`.
      Details: [Confirmations and photo proof](#confirmations-and-photo-proof-issue-15).

### 5a. Avatar gallery (issue #111)

- [ ] **Make the character sets (idle, walk, emote), then add them at Admin → Avatars** (needs
      the Blob store above). Brooklyn's sheet and Ryan's idle are the first two.
      Details: [Avatar gallery](#avatar-gallery-issue-111).

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

- [ ] **`MCP_PUBLIC_URL`** (Production) = `https://www.baumy.tech`, never a
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
# Optional (issue #79): the domain passkeys are bound to, the site's host or
# a parent of it. Production: baumy.tech (the app is www.baumy.tech).
# Unset, passkeys bind to BETTER_AUTH_URL's own host.
PASSKEY_RP_ID=
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
SIGN_IN_WITH_BAUMY=
TELEGRAM_BOT_USERNAME=
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
- [ ] **Create brain's service token** on production: Admin → Connections
      (`/admin/connections`) → Create token (name `baumy-brain`). It is
      shown once, with a Copy button; if you signed in over 10 minutes ago
      it asks you to confirm it's you (a passkey, your two-factor code, a
      Telegram tap or your password). (The terminal alternative is under
      [Brain actions endpoint](#brain-actions-endpoint-and-telegram-linking-issue-27).)
- [ ] **Review and merge baumy-brain PR #8** (Olympics client, `/link`,
      calendar/chore intents, issue #28). Reviewed overnight; two fixes
      pushed. Then in brain's Vercel project set `BRAIN_SERVICE_TOKEN` (the
      token you copied) and `OLYMPICS_BASE_URL` (the custom domain, one that does
      not redirect), redeploy, run `scripts/set-commands.ts` and
      `pnpm test:scenarios:live`.
- [ ] **Link Telegram:** Settings → Link Telegram → Open Telegram (or scan
      the QR code) → Start. The fallback is sending `/link <code>` to
      `@baumy_bot`. Then add "milk" in the Telegram group and see it on the
      kiosk within a minute.
      Details: [Shopping list](#shopping-list-issue-26),
      [Brain actions endpoint](#brain-actions-endpoint-and-telegram-linking-issue-27).

### 15. Kitchen iPad

- [ ] **Pair the iPad** (issue #126): open `/kiosk` on the iPad over HTTPS
      and scan its QR code with your phone, signed in as an admin; tap
      "Make it the kitchen screen". Each housemate sets their personal PIN
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
      placeholder until then. [CORRECTION 2026-09-28] The kit landed with
      issue #64 (ADR 0005, `packages/ui`): check the hub, sign-in and kiosk
      against the prototype (`proto/kiosk-home-pixel`). The "deferred to
      issue #7" items below are restyled in the same files.

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
      The functions run next to it: `apps/web/vercel.json` pins them to
      `fra1` (Frankfurt), and the privacy page says processing is in the EU.
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

What each piece does, and why, is in [deploy.md](deploy.md).
[CORRECTION 2026-09-29] Previews used to get their Neon branch from our own
workflow, with the integration's branching off; the Vercel Neon integration
now makes them, as in camp-404 (issue #99).

[CORRECTION 2026-09-29] **Previews are off** (issue #101): `apps/web/vercel.json`
sets `git.deploymentEnabled` to `{"**": false, "main": true}`, so no branch
but `main` creates a Vercel deployment and no PR gets a Neon branch. The
steps below still describe the setup, so previews work again by deleting
that key; the "Verify a normal PR" and "Verify the Dependabot skip" checks
apply only then. To check it now: push any branch and confirm Vercel lists no
deployment for it, and that the next merge to `main` still deploys to
production. Do not also set the dashboard's Ignored Build Step or disconnect
Git; the key is the one switch.

- [ ] **Create the Vercel project** from this repository: Root Directory
      `apps/web`, framework Next.js. `apps/web/vercel.json` sets the build
      command (`pnpm run vercel-build`) and the ignored-build step; leave both
      unset in the dashboard.
- [ ] **Vercel Neon integration:** installed and connected to this project,
      with preview branching **on** and its default env var names
      (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` direct). It makes
      `preview/<branch>` from the primary branch before each preview build
      and writes both as branch-scoped Preview env.
- [ ] **Production env** (Production scope): `DATABASE_URL` and
      `DATABASE_URL_UNPOOLED` as in "Database" above.
- [ ] **Preview env** (Preview scope, no git branch):
  - `PROD_DB_HOST` = the production **direct** host, for example
    `ep-xxx.eu-central-1.aws.neon.tech`. Without it every preview's
    `db:migrate` fails closed.
  - `DATABASE_URL` / `DATABASE_URL_UNPOOLED`: leave the unscoped ones
    **unset**, or point them at a throwaway Neon branch named
    `preview-default`. Never production.
  - Never `NEON_LOCAL_PROXY` or `E2E_TEST_MODE`.
- [ ] **Repository secrets** (Settings → Secrets and variables → Actions):
      `NEON_API_KEY` and `NEON_PROJECT_ID`. Without them every closed PR's
      cleanup run fails red (camp-404's behaviour), so a leak is never silent.
      Delete `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_IDS` if they
      are still set; nothing reads them.
- [ ] **Clear the backlog once.** Nothing deleted the integration's branches
      before issue #99, so the quota filled. Delete the leftover `preview/*`
      branches of closed PRs (deploy.md, "the branch quota").
- [ ] **Verify a normal PR.** Open a throwaway PR. Expect: Neon shows
      `preview/<branch>`, and the Vercel build log shows
      `[migrate] VERCEL_ENV=preview, target host: ep-…` with a host that is
      **not** `PROD_DB_HOST`. Close it and check the cleanup run ("Delete
      Neon branch for closed PR") removes the branch.
- [ ] **Verify the Dependabot skip.** Push a branch named
      `dependabot/test-guard` and open a PR from it. Expect: the Vercel
      deployment shows as "Ignored". Note whether a `preview/dependabot/*`
      branch appears in Neon anyway (the integration may provision before the
      ignored-build step runs); either way, closing the PR must leave none.
      Close the PR and delete the branch.
- [ ] **Verify the guard on Vercel** (optional; CI already proves it against
      Docker Postgres): on a throwaway branch, set a branch-scoped Preview
      `DATABASE_URL_UNPOOLED` equal to the production string, redeploy, and
      check the build fails with `points at the production host`. Delete the
      row afterwards.

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
      visit: `https://www.baumy.tech` (owner decision 2026-09-28; the apex redirects to it). Leave it unset on Preview:
      a preview uses its own `VERCEL_URL`.
- [ ] **Resend, for password reset.** Create a Resend account, verify the
      sending domain, then set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (for
      example `Baumy Olympics <hello@baumy.tech>`) in Vercel. Without both,
      `/auth/forgot-password` says reset is off, and nobody can recover a
      forgotten password.
- [ ] **Google sign-in (optional).** In Google Cloud Console create an OAuth
      client (type Web application) with the authorised redirect URI
      `https://www.baumy.tech/api/auth/callback/google` (JavaScript origin `https://www.baumy.tech`), then set `GOOGLE_CLIENT_ID`
      and `GOOGLE_CLIENT_SECRET` (Production scope). The button only appears
      when both are set. Previews cannot finish a Google sign-in (Google only
      calls back registered URIs); use email and password there.
- [ ] **The consent screen's logo (optional).** Google Cloud Console →
      Google Auth Platform → Branding → App logo: upload
      `design/logo/baumy-badge-120.png` (120×120, the size Google asks for).
      Adding a logo makes Google want to verify the app's branding before
      the logo shows to anyone outside it; an app left in **Testing** (with
      the housemates added as test users) skips that, so skip the logo or
      stay in Testing unless you mean to go through verification.
- [ ] **Never set** `AUTH_EMAIL_CAPTURE_FILE`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`
      or `AUTH_RATE_LIMIT_MAX` on Vercel. All three are ignored
      there anyway; they exist only for the e2e harness.
- [ ] **After the first production deploy**, sign up at `/auth/sign-up`,
      sign out, sign in, and request a password reset to check the email
      arrives. The deploy log should show no `[auth]` warning.

## Passkeys, two-factor and devices (issue #79)

Settings → Security (`/settings/security`) has passkeys, two-factor (an
authenticator app plus backup codes), linking and unlinking Google, adding a
first password to a Google-only account, and the devices signed in now. No
new service: it all runs on Better Auth and our own tables (migration 0016).

- [ ] **`BETTER_AUTH_URL=https://www.baumy.tech`** and
      **`PASSKEY_RP_ID=baumy.tech`** (both Production). The canonical app is
      `https://www.baumy.tech`; passkeys are bound to the registrable domain
      `baumy.tech` (the relying-party id), and a ceremony is accepted only
      from the origin `https://www.baumy.tech`. A passkey made under one id
      never works under another, so do not change `PASSKEY_RP_ID` once people
      have added passkeys. Binding to `baumy.tech` rather than the www host
      keeps them working if the app ever moves to the apex or another
      subdomain.
- [ ] **Serve one host.** Redirect the apex `baumy.tech` to
      `https://www.baumy.tech` in Vercel (Settings → Domains). A passkey
      ceremony from any other origin is refused.
- [ ] **If `PASSKEY_RP_ID` is wrong,** meaning it is neither the site's host
      nor a parent of it, passkeys switch **off** (fail closed) and the
      deploy log says so. Leave it unset on Preview: previews bind passkeys
      to their own `*.vercel.app` host, so a passkey made on a preview never
      works on production, and the other way round.
- [ ] **Google.** The OAuth client's authorised JavaScript origin is
      `https://www.baumy.tech`, and its redirect URI is
      `https://www.baumy.tech/api/auth/callback/google`. Signing in and
      "Link Google" both use it.
- [ ] **After deploy:** on your phone, add a passkey on Settings → Security,
      sign out, and sign in with "Sign in with a passkey". Then turn on
      two-factor with an authenticator app and keep the backup codes.

Worth knowing:

- Passkeys and two-factor need a **confirmed email** (the sign-up link or
  Google). An unconfirmed account's passkeys and two-factor are cleared by a
  password reset.
- Two-factor asks for a code after a **password** sign-in. Google,
  passkey and Sign in with Baumy sign-ins are not asked: a passkey is two
  factors already, Google has its own, and the Telegram tap counts as the
  second factor (owner ruling 2026-09-29, ADR 0006).
- Signing a device out ends its session at once, but a page it has open can
  keep working for up to **5 minutes** (the cookie cache); the page says so.
- The Security page never lets you remove your last way in (a password,
  Google or a passkey).

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
      signing up with Google (Google addresses count as verified; a Google
      sign-in no longer links itself to an existing password account).
- [ ] **After the first production deploy**: sign up with a founder address,
      open the confirmation email, go to `/join` and press "Join as admin".
      Then open `/admin/members`, create an invite code and check that a
      second account can redeem it.
- `INVITE_CODES` in SPEC §6.8 is not read by anything yet (marked
  UNRESOLVED there): say whether it should go, or what it should seed.

## Kiosk (issue #10)

Nothing here needs an account or a secret, and no new env var: pairing,
the device cookie and PIN attestation are tested on PGlite, on Docker
Postgres (concurrent claims and guesses) and end to end in `ipad-portrait`.

- [ ] **Serve the kiosk over HTTPS.** The `baumy_kiosk` cookie is `Secure`,
      so the iPad can pair only over HTTPS (production or a preview URL).
      `http://localhost` works for development; a dev machine reached over
      plain http on the LAN does not.
- [ ] **After the first production deploy, pair the iPad:**
      [CORRECTION 2026-10-01, issue #126] open `/kiosk` on the iPad; it shows
      a QR code. Scan it with your phone (signed in as an admin) and tap
      "Make it the kitchen screen"; the iPad pairs itself. No code is typed
      on the iPad any more ([kiosk-setup.md](kiosk-setup.md)). Add `/kiosk`
      to the home screen. Each housemate sets their personal PIN in `/settings` on their own
      phone, then taps their avatar on the iPad and tries "Check my PIN".
- [ ] **Keep the iPad awake** until issue #29 adds the wake lock: Settings →
      Display & Brightness → Auto-Lock → Never, and Guided Access if you want
      it locked to the app.
      [CORRECTION 2026-09-27] issue #29 added the wake lock; the full setup
      is [kiosk-setup.md](kiosk-setup.md) (see "Kitchen iPad" below).
- If the iPad is lost, sign it out on `/admin/kitchen-screen` ("Sign out";
  before issue #126 this was "Revoke" on `/admin/members`); it is sent back
  to `/kiosk/pair` on its next request.

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

- [ ] **Create a PRIVATE Blob store in Frankfurt** in Vercel (Storage → Blob
      → Create, access "Private", region Frankfurt `fra1`; a store's region
      is fixed when it is created and defaults to `iad1`, Washington). If an
      existing store is in `iad1`, create a new one in `fra1` and swap the
      token (no photos exist yet). The privacy page says photos are stored in
      Frankfurt (the house's store is, owner 2026-09-28), so keep it there. Connect it to the project for Production (and
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
      `/activity`: the claim shows the photo. Opening that photo's
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
      shows on `/activity` (scheduled, with Veto) for everyone else to veto
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
  admin rules on it on `/activity`; then the next run writes the winner.

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

- [ ] **After the deploy, check it on the kitchen iPad (Safari):** tap the
      cat and your avatar; Safari asks for the microphone the first time,
      allow it. Hold "Hold to talk", say "who's winning?" and let go
      [CORRECTION 2026-10-02, issue #132: was "open Baumy, hold Hold to
      speak" in the sheet]. Baumy's answer shows in the cat's bubble, and
      one `groq` row lands in `ai_usage` with its `audio_seconds`. If you
      deny the microphone, the typing sheet opens and says so; allow it
      again in Settings → Apps → Safari → Microphone
      ([kiosk-setup.md §4](kiosk-setup.md#4-talking-to-baumy)).
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
      address people use, `https://www.baumy.tech` (the
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
      `curl https://www.baumy.tech/.well-known/oauth-authorization-server`
      shows `"issuer": "https://www.baumy.tech"` and
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

- [ ] **Check it answers:** `curl -i -X POST https://www.baumy.tech/api/mcp/mcp`
      is a 401 whose `WWW-Authenticate` names
      `resource_metadata="https://www.baumy.tech/.well-known/oauth-protected-resource"`.
- [ ] **Connect claude.ai** (Pro, Max, Team or Enterprise): Settings →
      Connectors → Add custom connector → paste
      `https://www.baumy.tech/api/mcp/mcp` → Connect. Sign in to Baumy if
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
      `BRAIN_BASE_URL` to brain's production URL,
      `https://brain.baumy.tech` (no trailing path), and
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

## One-tap Telegram linking (issue #108)

Settings → **Link Telegram** makes the one-time link code as before and shows
it as a Telegram deep link, `https://t.me/baumy_bot?start=link_<code>`: an
**Open Telegram** button and a QR code of the same link (for linking from a
phone while on a laptop). Tapping **Start** in Telegram sends the bot
`/start link_<code>`, which brain redeems like `/link <code>`; Settings then
says "Linked" on its own. `/link <code>` stays as the fallback.

- [ ] **Merge and deploy the brain side:** the baumy-brain PR that handles
      `/start link_<code>` (linked from Olympics PR for issue #108). Until it
      is deployed, Start only shows brain's intro and the member uses the
      `/link <code>` line under the QR code instead.
- [ ] **Nothing to set** for the live bot: the username defaults to
      `baumy_bot`. Set `TELEGRAM_BOT_USERNAME` in Vercel only for another bot
      (a test bot, say); a value that is not a Telegram username falls back
      to `baumy_bot`.
- [ ] **Add this line to `.env.example`** by hand (it is in turbo
      `globalEnv`):

      ```
      # One-tap Telegram linking (issue #108): the bot Settings' "Link Telegram"
      # deep link opens. Unset means baumy_bot.
      TELEGRAM_BOT_USERNAME=
      ```

## Sign in with Baumy (issue #80)

"Sign in with Baumy" signs a member in by tapping, in a Telegram DM from
Baumy, the number the sign-in page shows (ADR 0006). It is **off** until you
switch it on, because it needs the brain side deployed first. Migrations
0014 and 0015 run on deploy either way.

- [ ] **Merge and deploy the brain side first:** baumy-brain PR
      RyRy79261/baumy-brain#10 (after #7 and #8). It adds
      `POST /api/kitchen/login-approval` on the same `KITCHEN_API_TOKEN`, so
      `BRAIN_BASE_URL` (for example `https://brain.baumy.tech`) and
      `KITCHEN_API_TOKEN` must already be set here (Shopping list, above).
- [ ] **Each member presses Start in a DM with Baumy once**, and has their
      Telegram linked (`/link` or `/admin/members`). Telegram does not let a
      bot DM someone who never started it; brain then answers `sent: false`
      and the page simply waits and expires.
- [ ] **Then switch it on** in this app's Vercel project (Production):
      `SIGN_IN_WITH_BAUMY=on`, and redeploy. Anything else (unset, `off`,
      `1`) keeps the button hidden and the three routes answering 404.
- [ ] **Add this line to `.env.example`** by hand (it is in turbo
      `globalEnv`):

      ```
      # "Sign in with Baumy" (issue #80): "on" shows the button and serves
      # /api/login-approval/*. Turn it on only after baumy-brain PR #10 is
      # deployed.
      SIGN_IN_WITH_BAUMY=
      ```

- [ ] **Check it** on the kitchen iPad: Sign in with Baumy, your email, then
      tap the same number in Telegram; the iPad signs in. Tap a different
      number or Deny once: the page says it was denied, and the method is off
      for you for 15 minutes (your password still works).
- A session made this way is a browser session: its cookie goes when the
  browser closes and the server ends it after 24 hours at most, unlike the
  30 days of a password sign-in.
- It works with two-factor on, and asks for no code: the tap is the second
  factor (owner ruling 2026-09-29).

## Brain actions endpoint and Telegram linking (issue #27)

`/api/v1/actions` lets baumy-brain run Olympics actions for a linked
Telegram user; the contract is [brain-integration.md](brain-integration.md).
Migration `0010_service_tokens` runs on deploy. No new env var in this app:
it keeps only the token's hash, in the database. Until a token is minted
every call answers 401, so nothing is exposed. CI and e2e mint their own
tokens against Docker Postgres.

- [ ] **Create brain's token** (updated 2026-09-29, issue #104: no
      terminal): as an admin on production, open Admin → Connections
      (`/admin/connections`) and press **Create token** with the name
      `baumy-brain`. The token is shown once, with a Copy button; only its
      hash is stored, and neither the audit trail nor the request ledger
      keeps it. Unless you signed in within the last 10 minutes it asks
      you to confirm it's you, with any way you have: a passkey, your
      two-factor code, a Sign in with Baumy tap, your password or Google
      [CORRECTION 2026-10-02, issue #135: it used to ask for the password
      only].

      The terminal still works, from a checkout of `main` with the direct
      (unpooled) Neon string:

      ```sh
      DATABASE_URL_UNPOOLED='<direct production string>' \
        pnpm --filter @baumy/db --silent service-token mint baumy-brain
      ```

- [ ] **In baumy-brain's Vercel project** (Production) set
      `BRAIN_SERVICE_TOKEN` to that token and `OLYMPICS_BASE_URL` to this
      app's production URL (the names issue #28 gives brain's client), then
      redeploy brain once that client exists.
- [ ] **Link your own Telegram account** once brain is deployed: Settings →
      Link Telegram → Open Telegram (or scan its QR code with your phone) →
      Start. Or send `/link <code>` to `@baumy_bot`, or, as an admin, type a
      member's Telegram user id on `/admin/members`.
- [ ] **Check it** with a curl from your machine (the example at the end of
      brain-integration.md): with `X-Baumy-Confirmed: 1` the event appears on
      `/calendar`; without it the answer is 428 `CONFIRMATION_REQUIRED`.
- To rotate the token, press **Rotate** on its row in `/admin/connections`
  (or run `service-token rotate baumy-brain`). The old one stops at once,
  so update brain's env and redeploy it straight away.
- To cut brain off, press **Revoke** there, or run
  `service-token revoke baumy-brain`. The row's "Last used" shows when
  brain last called.

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

## Avatar gallery (issue #111)

Owner ruling 2026-09-29: "have a collection of pre-generated avatars to select from, that way
they're integrated and uniform." The app never draws a character; it only cleans what you upload.

Each character is a SET of three poses (owner ruling 2026-09-29): **idle** (standing,
three-quarter; used everywhere), **walk** (a short walk-in on the kitchen screen when someone taps
in) and **emote** (for example laughing with a peace sign: when they score, when they tap "I've
seen it", and for the scoreboard's leader). A set with only idle works; walk and emote can come
later as a new set.

1. Make each set with Nano Banana (Gemini image), all three poses side by side on ONE image,
   with this shared prompt so they match (add the person's description, or attach their photo,
   after it):

   ```text
   16-bit JRPG chibi pixel-art character sheet of one character, three full-body poses side
   by side, left to right: 1) idle, standing, three-quarter view; 2) walking, mid-stride;
   3) emote, laughing with a peace sign. Same character, same size and scale in every pose,
   feet on one line, space between the poses. Big head and small body, clean dark outline,
   flat shading with at most 24 colours, no dithering, no text, no shadow on the ground.
   Plain solid black background. Crisp square pixels. The character:
   ```

2. Download the image (PNG, JPEG or WebP; 4 MB at most; never SVG).
3. In the app: **Admin → Avatars → Add a character**, choose the sheet (or one file per pose).
   It shows before and after: the background (solid black or any flat colour, or a fake grey
   checkerboard) is removed from the edges in, the figures found left to right and cleaned at
   one scale with one palette of 24 colours, and the idle pose shown at the app's sizes. Pick
   48, 56 or 64 pixels tall (64 by default), check each figure's pose (change it, or skip one),
   name it and **Save to gallery**.
4. Everyone picks theirs in **Settings → Your character** (a founder can also pick on
   `/join`; someone joining with a code is taken to Settings to pick). Two
   housemates may pick the same one; tell an agent if you want that refused. Anyone who has
   not picked (or while the gallery is empty) shows as their initial in their colour.
5. **Archive** takes a character out of the gallery; whoever already wears it keeps it.
   **Restore** puts it back. Nothing is ever deleted.

If a cleaned character looks wrong (bits of background left, part of the character gone),
regenerate it on a plain flat background of a colour the character does not use.
