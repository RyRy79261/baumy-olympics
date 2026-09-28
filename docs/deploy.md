# Deploy: Vercel, Neon previews and migrate-on-build

How `apps/web` reaches Vercel, how each pull request gets its own database,
and what stops a preview from touching production. The decision is
[ADR 0004](decisions/0004-skip-previews-for-dependabot.md). The one-off
account steps are in [SETUP.md](SETUP.md).

[CORRECTION 2026-09-29] **Preview deployments are off (issue #101).** The
Hobby account's 100 deployments a day are shared by about seven projects,
and this one used 27 in a day. `apps/web/vercel.json` sets
`git.deploymentEnabled` to `{"**": false, "main": true}`: no branch but
`main` creates a Vercel deployment at all, so a PR gets no preview URL, no
Vercel check and no Neon branch. `main` still deploys to production. GitHub
CI (the gate and e2e against Docker Postgres) still tests every PR. The
preview machinery below (the integration's branching, the migrate guard, the
ignored-build step, `neon-pr-cleanup.yml`) stays as a harmless safety net and
works unchanged if previews are ever turned back on, by deleting that key.
Why `**` and not `*`: Vercel matches the keys with minimatch, where `*` stops
at `/` and so would not match `feat/x`; `**` matches every branch name. A
branch matching both keys deploys, because Vercel deploys when any matching
rule is `true`. (A branch whose name starts with a dot matches neither and
would still deploy; we never use one.)

[CORRECTION 2026-09-29] Until issue #99 our own workflow
(`neon-pr-preview.yml` + `scripts/neon-preview-env.sh`) made the preview
branches and a `NEON_PREVIEW_READY` gate held each preview's first build.
It duplicated the Vercel Neon integration, whose `preview/<branch>` branches
were never deleted; the branch quota filled and previews failed with
"Resource provisioning failed". Now the integration owns preview branches, as
in camp-404, and a cleanup workflow copied from camp-404 deletes them.

## The pieces

| File                                    | What it does                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Neon integration (dashboard)     | On each preview deployment: creates Neon branch `preview/<branch>` from the primary branch and writes its branch-scoped `DATABASE_URL*` Preview env.          |
| `apps/web/vercel.json`                  | `git.deploymentEnabled` (only `main` deploys); build command `pnpm run vercel-build`; ignored-build step `bash ../../scripts/vercel-ignore-build.sh`.         |
| `apps/web/package.json` `vercel-build`  | `pnpm --filter @baumy/db db:migrate && pnpm --filter @baumy/db db:seed && next build`. Migrations run on every deploy; the seed adds the starter chores once. |
| `packages/db/scripts/seed.ts`           | `db:seed` (issue #14). Same guard as `db:migrate`; adds the SPEC §4.7 starter chores only while the household has no chores at all.                           |
| `packages/db/scripts/migrate.ts`        | `db:migrate`. Asks the guard (`src/migrate-guard.ts`), logs the target **host** only, then applies the migrations to `DATABASE_URL_UNPOOLED`.                 |
| `scripts/vercel-ignore-build.sh`        | Skips `dependabot/*` refs. Everything else builds.                                                                                                            |
| `.github/workflows/neon-pr-cleanup.yml` | On PR close: deletes the Neon branches named `preview/<head branch>…` (prefix match, never the primary).                                                      |

The cleanup workflow is camp-404's as-is
(`/home/ryan/repos/Personal/camp-404/.github/workflows/neon-pr-cleanup.yml`),
and the flow matches camp-404's: the integration makes each preview's branch,
`vercel-build` migrates it, the cleanup deletes it.

## What happens on a pull request

With previews off (issue #101), nothing on Vercel or Neon: GitHub CI runs,
and the steps below do not happen. They describe the flow if previews are
turned back on.

1. You push a branch and open a PR. Vercel starts a preview deployment; the
   Neon integration creates `preview/<branch>` (a copy of production's data)
   and sets that branch's `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
   (direct) for the deployment.
2. `vercel-build` runs: `db:migrate` logs `target host: ep-…` (the preview
   branch's host) and migrates that branch, then `next build` runs.
3. Later pushes reuse the same branch.
4. Closing the PR (merged or not) runs `neon-pr-cleanup.yml`
   (`pull_request_target`, no PR code checked out, same-repo PRs only), which
   deletes the non-primary branches whose name starts with
   `preview/<head branch>`.

Production deploys from `main` build unconditionally, and `db:migrate`
migrates the production database named by the Production-scope
`DATABASE_URL_UNPOOLED`.

## Dependabot

A `dependabot/*` branch gets no Vercel build (the ignored-build step). CI
still runs in full against Docker Postgres, so the bump is tested; it just has
no preview URL. If the integration provisions a branch before the
ignored-build step runs, the cleanup still deletes it when the PR closes: it
runs under `pull_request_target`, so Dependabot closes get the repository's
secrets.

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

It works unchanged with the integration: the integration's per-preview
`DATABASE_URL_UNPOOLED` is the preview branch's direct host, which is never
`PROD_DB_HOST`. If the integration fails to write it, the guard sees either
nothing (refuse) or the Preview-scope default (below).

### Rule: the Preview-scope default database

The Vercel Preview scope's **unscoped** `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` must be **unset**, or point at a throwaway Neon branch
named `preview-default`. Never at production. The guard is the second line of
defence, not the first: a preview's runtime also reads `DATABASE_URL`.

`PROD_DB_HOST` is set in the **Preview** scope (it may be set in Production
too; production ignores it) to the production direct host, for example
`ep-xxx.eu-central-1.aws.neon.tech`.

## Secrets

Repository secrets (Settings → Secrets and variables → Actions), used only by
the cleanup workflow. Without them every closed PR's cleanup run fails red, so
a leak cannot go unnoticed.

| Secret            | Value                                       |
| ----------------- | ------------------------------------------- |
| `NEON_API_KEY`    | Neon API key (Account settings → API keys). |
| `NEON_PROJECT_ID` | The Neon project id.                        |

`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_IDS` were for the retired
workflow; nothing reads them now.

Vercel project env vars:

| Variable                            | Production      | Preview                                                                                             |
| ----------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | prod pooled URL | per branch from the integration; the unscoped value unset, or the `preview-default` branch's pooled |
| `DATABASE_URL_UNPOOLED`             | prod direct URL | per branch from the integration; the unscoped value unset, or the `preview-default` branch's direct |
| `PROD_DB_HOST`                      | optional        | **required**: the prod direct host                                                                  |
| `NEON_LOCAL_PROXY`, `E2E_TEST_MODE` | never           | never                                                                                               |

## When every preview fails in about one second: the branch quota

Learned on afrikaburn (PR #10, 3 Aug 2026), and again here (issue #99). A
Neon project has a branch quota. The Vercel–Neon integration creates a branch
per preview and never deletes one, so the quota fills; after that Neon refuses
new branches and Vercel **rejects the preview deployment in about one
second** ("Resource provisioning failed"), before any build starts. It looks
exactly like a broken build, and it is not: production keeps deploying (it
needs no new branch) and every local reproduction passes. Recognise it by the
clock: a real build takes minutes, a quota rejection about one second.

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

# Migrate a database (the guard applies here too).
DATABASE_URL_UNPOOLED='postgres://…' pnpm --filter @baumy/db db:migrate
```

Tests: `packages/db/src/__tests__/migrate-guard.test.ts` (the guard),
`scripts/tests/vercel-ignore-build.test.sh` (the ignored-build step),
`scripts/tests/vercel-deployment-enabled.test.sh` (only `main` deploys), and the
`db-local` CI job, which runs `vercel-build` on a "preview" pointed at
`PROD_DB_HOST` and expects it to fail.
