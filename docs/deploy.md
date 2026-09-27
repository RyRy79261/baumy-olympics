# Deploy: Vercel, Neon previews and migrate-on-build

How `apps/web` reaches Vercel, how each pull request gets its own database,
and what stops a preview from touching production. The decision is
[ADR 0004](decisions/0004-skip-previews-for-dependabot.md). The one-off
account steps are in [SETUP.md](SETUP.md).

## The pieces

| File                                    | What it does                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/vercel.json`                  | Build command `pnpm run vercel-build`; ignored-build step `bash ../../scripts/vercel-ignore-build.sh`.                                                        |
| `apps/web/package.json` `vercel-build`  | `pnpm --filter @baumy/db db:migrate && pnpm --filter @baumy/db db:seed && next build`. Migrations run on every deploy; the seed adds the starter chores once. |
| `packages/db/scripts/seed.ts`           | `db:seed` (issue #14). Same guard as `db:migrate`; adds the SPEC §4.7 starter chores only while the household has no chores at all.                           |
| `packages/db/scripts/migrate.ts`        | `db:migrate`. Asks the guard (`src/migrate-guard.ts`), logs the target **host** only, then applies the migrations to `DATABASE_URL_UNPOOLED`.                 |
| `scripts/vercel-ignore-build.sh`        | Skips `dependabot/*` refs, and previews until `NEON_PREVIEW_READY=1`. Production always builds.                                                               |
| `.github/workflows/neon-pr-preview.yml` | On PR open/push: creates `preview/<branch>` in Neon, writes branch-scoped Preview env, then deploys.                                                          |
| `scripts/neon-preview-env.sh`           | The work behind that workflow.                                                                                                                                |
| `.github/workflows/neon-pr-cleanup.yml` | On PR close: deletes the Neon branch and its branch-scoped Vercel env rows.                                                                                   |

All three were copied from afrikaburn-contributors-app
(`origin/main:.github/workflows/neon-pr-*.yml`,
`origin/main:scripts/neon-preview-env.sh`); the differences are listed at the
top of each file.

## What happens on a pull request

1. You push a branch and open a PR. Vercel starts a git-triggered preview
   deployment. Its ignored-build step sees no `NEON_PREVIEW_READY` for the
   branch yet and **skips** it (the deployment shows as "Ignored").
2. `neon-pr-preview.yml` runs from `main` (`pull_request_target`, base
   checkout only, so a PR cannot change the script that holds the tokens). It
   creates Neon branch `preview/<branch>` from the primary branch, with a
   read-write compute, and writes three **git-branch-scoped** Preview env vars
   on the Vercel project: `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`
   (direct) and, last, `NEON_PREVIEW_READY=1`. It logs only the database host.
3. It then asks Vercel to deploy the PR's head commit. That is the PR's first
   real build: `db:migrate` logs `target host: ep-…` (the preview branch's
   host) and migrates that branch, then `next build` runs.
4. Later pushes build straight away (the env is already there); the workflow
   sees the branch and all three rows in place and does nothing.
5. Closing the PR (merged or not) runs `neon-pr-cleanup.yml`, which deletes
   `preview/<branch>` and the three env rows.

Production deploys from `main` build unconditionally, and `db:migrate`
migrates the production database named by the Production-scope
`DATABASE_URL_UNPOOLED`.

## Dependabot

A PR from `dependabot[bot]`, or any branch named `dependabot/*`, gets no Neon
branch (the workflow's `if:` checks both the PR author and the head ref) and no
Vercel build (the ignored-build step). CI still runs in full against Docker
Postgres, so the bump is tested; it just has no preview URL.

## The preview migrate guard

`db:migrate` refuses to run (exit 1, which fails the Vercel build before
`next build` starts) when:

- `DATABASE_URL_UNPOOLED` is unset, not a `postgres://` URL, or a Neon
  `-pooler` host (a migration must not run through PgBouncer), in any
  environment;
- `VERCEL_ENV=preview` and `PROD_DB_HOST` is unset (it fails closed: without
  it the guard cannot tell production apart);
- `VERCEL_ENV=preview` and the host of `DATABASE_URL_UNPOOLED` or
  `DATABASE_URL` equals `PROD_DB_HOST`. A `-pooler` suffix, a port or a whole
  URL in `PROD_DB_HOST` are all normalised away first.

### Rule: the Preview-scope default database

The Vercel Preview scope's **unscoped** `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` must be **unset**, or point at a throwaway Neon branch
named `preview-default`. Never at production. The guard is the second line of
defence, not the first: a preview's runtime also reads `DATABASE_URL`.

`PROD_DB_HOST` is set in the **Preview** scope (it may be set in Production
too; production ignores it) to the production direct host, for example
`ep-xxx.eu-central-1.aws.neon.tech`.

## Secrets

Repository secrets (Settings → Secrets and variables → Actions). Without them
both workflows print a notice and exit 0, so CI stays green; previews are then
skipped because nothing writes `NEON_PREVIEW_READY`, and production still
deploys.

| Secret               | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `NEON_API_KEY`       | Neon API key (Account settings → API keys).                            |
| `NEON_PROJECT_ID`    | The Neon project id.                                                   |
| `VERCEL_TOKEN`       | A Vercel access token scoped to the team that owns the project.        |
| `VERCEL_ORG_ID`      | The team id, `team_…` (Team settings → General).                       |
| `VERCEL_PROJECT_IDS` | The `prj_…` id of the `apps/web` project. Comma-separated if it grows. |

Vercel project env vars:

| Variable                            | Production      | Preview                                               |
| ----------------------------------- | --------------- | ----------------------------------------------------- |
| `DATABASE_URL`                      | prod pooled URL | unset, or the `preview-default` branch's pooled URL   |
| `DATABASE_URL_UNPOOLED`             | prod direct URL | unset, or the `preview-default` branch's direct URL   |
| `PROD_DB_HOST`                      | optional        | **required**: the prod direct host                    |
| `NEON_PREVIEW_READY`                | never           | written per branch by the workflow; never set by hand |
| `NEON_LOCAL_PROXY`, `E2E_TEST_MODE` | never           | never                                                 |

## When every preview fails in about one second: the branch quota

Learned on afrikaburn (PR #10, 3 Aug 2026). A Neon project has a branch
quota. The Vercel–Neon integration creates a branch per preview and never
deletes one, so the quota fills; after that Neon refuses new branches and
Vercel **rejects the preview deployment in about one second**, before any
build starts. It looks exactly like a broken build, and it is not: production
keeps deploying (it needs no new branch) and every local reproduction passes.
Recognise it by the clock: a real build takes minutes, a quota rejection about
one second.

Here the branches come from our workflow, not the integration (keep the
integration's preview branching **off**, or both will create branches), so a
full quota shows up instead as a red `neon-preview-env` run saying
`failed to create or find Neon branch`, and the preview stays Ignored.
`neon-pr-cleanup.yml` deletes each PR's branch when it closes, which prevents
the leak but does not clear a backlog. To list leftover preview branches:

```sh
curl -sS -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
  | jq -r '.branches[] | select(.primary != true) | select(.name | startswith("preview/")) | "\(.id)  \(.name)"'
```

Check the list against open PRs, then `DELETE .../branches/<id>` the ones
whose PR has closed. Never touch the primary branch (production) or
`preview-default`.

## Running the pieces by hand

```sh
# What would the ignored-build step do?
VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feat/x bash scripts/vercel-ignore-build.sh; echo $?

# Provision a branch without deploying (needs the five secrets in your shell).
HEAD_REF=feat/x SKIP_REDEPLOY=1 bash scripts/neon-preview-env.sh
HEAD_REF=feat/x DRY_RUN=1 bash scripts/neon-preview-env.sh

# Migrate a database (the guard applies here too).
DATABASE_URL_UNPOOLED='postgres://…' pnpm --filter @baumy/db db:migrate
```

The workflow also has a `workflow_dispatch` input (`head_ref`) to wire a branch
before the workflow itself is on `main`.

Tests: `packages/db/src/__tests__/migrate-guard.test.ts` (the guard),
`scripts/tests/*.test.sh` (the ignored-build step, and the provisioning script
against a fake `curl`), and the `db-local` CI job, which runs `vercel-build` on
a "preview" pointed at `PROD_DB_HOST` and expects it to fail.
