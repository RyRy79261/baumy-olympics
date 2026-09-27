# Setup: things only the owner can do

Steps that need an account, a secret or admin rights on GitHub. Code that
depends on them is written to skip or fail closed until they are done, so CI
stays green in the meantime. Tick an item off here in the PR that finishes it.

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
