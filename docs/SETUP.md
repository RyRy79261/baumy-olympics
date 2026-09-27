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
      the prod-host guard (`PROD_DB_HOST`) come with issue #5 (ADR 0004).
- [ ] **Apply the migrations to Neon once** until migrate-on-build lands
      (issue #5), from a machine with the direct string:

  ```sh
  DATABASE_URL_UNPOOLED='postgres://…' pnpm --filter @baumy/db db:migrate
  ```

  Then check that `households` holds exactly one row, `Baumy household`.
