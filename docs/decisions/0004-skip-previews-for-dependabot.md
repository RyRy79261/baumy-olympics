# 0004: Neon preview branches from a GitHub workflow, skipped for Dependabot

- Status: accepted (2026-09-27); decisions 1, 2, 5 and the `NEON_PREVIEW_READY` part of 6 superseded 2026-09-29 (issue #99)

[CORRECTION 2026-09-29] Owner: the Vercel Neon integration manages preview branches in every other repository. Here our own workflow duplicated it, the integration's `preview/<branch>` branches were never deleted, the Neon branch quota filled, and previews failed with "Resource provisioning failed". The integration now owns preview branches (preview branching on), as in camp-404: `neon-pr-preview.yml`, `scripts/neon-preview-env.sh` and the `NEON_PREVIEW_READY` build gate are removed, and `neon-pr-cleanup.yml` is camp-404's (`.github/workflows/neon-pr-cleanup.yml`) as-is, deleting `preview/<head branch>` by prefix on close. The Dependabot build skip (3, 4), the migrate guard (6, without the readiness gate) and `dependabot.yml` (7) stand. The superseded items are marked below; `docs/deploy.md` describes the current flow.

[CORRECTION 2026-09-29] Owner: the Hobby account (100 deployments a day, shared by about seven projects) is near its limit, and this project used 27 in a day. **Vercel preview deployments are off** (issue #101): `apps/web/vercel.json` sets `git.deploymentEnabled` to `{"**": false, "main": true}`, so only `main` deploys (to production) and no other branch creates a deployment. With no preview deployments the Neon integration creates no preview branches. GitHub CI (with e2e on Docker Postgres) still tests every PR. The Dependabot skip (3), the migrate guard (6) and `neon-pr-cleanup.yml` stay as a harmless safety net, and apply again if the key is removed.

## Context

The owner remembered AfrikaBurn having "a trick to stop Dependabot creating Neon previews", and he was right. afrikaburn origin/main (added in ef65a4e, #65; still there at 46f0ed2) has:

- `.github/workflows/neon-pr-preview.yml`, whose job is guarded by `github.event.pull_request.user.login != 'dependabot[bot]'`, keyed on the PR author rather than `github.actor`.
- `neon-pr-cleanup.yml`, which uses `pull_request_target` so that it can still _delete_ a branch when a Dependabot PR closes.
- `.github/dependabot.yml` with a 2-day `cooldown`, a lockstep `vitest` group and `better-auth` / `@better-auth/*` ignores, and a commitlint ignore for `chore(deps): Bump …` (Dependabot capitalises `Bump`; the lower-case form is accepted too).

afrikaburn does not skip the Vercel build for Dependabot, so such a PR builds against the Preview env's default `DATABASE_URL*` ("in practice production, or nothing", its `docs/deploy.md`). The same happens on the _first_ build of every PR, because `neon-preview-env.sh` sets branch-scoped env vars and redeploys only after the git-triggered build has started. With migrate-on-build, that build would migrate the wrong database.

When the Neon branch quota fills up, every Vercel preview fails within about one second.

## Decision

1. [CORRECTION 2026-09-29: superseded; the integration provisions previews.] **Use afrikaburn's workflow-based provisioning rather than the Vercel–Neon integration.** Copy `neon-pr-preview.yml`, `neon-pr-cleanup.yml` and `scripts/neon-preview-env.sh`. They run under `pull_request_target`, check out only the base branch, and exit 0 when secrets are missing.
2. [CORRECTION 2026-09-29: superseded; there is no preview job. The ignored-build step (3) is the Dependabot skip.] **Copy afrikaburn's Dependabot guard, and add a `head.ref` check** to the preview job:
   ```yaml
   if: >
     github.event_name == 'workflow_dispatch' ||
     (github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.user.login != 'dependabot[bot]' &&
      !startsWith(github.event.pull_request.head.ref, 'dependabot/'))
   ```
3. **Skip the Vercel build for Dependabot branches.** In `apps/web/vercel.json`, set `"ignoreCommand": "bash ../../scripts/vercel-ignore-build.sh"`. The script exits 0 (skip) when `VERCEL_GIT_COMMIT_REF` starts with `dependabot/`, and exits 1 (build) otherwise.
4. **Dependabot PRs still run full CI.** CI uses Docker Postgres, not Neon, so dependency bumps are still tested.
5. [CORRECTION 2026-09-29: superseded; the cleanup workflow is now camp-404's, and it is the only thing that deletes preview branches.] **Keep the cleanup workflow unchanged**, as a safety net.
6. **Guard preview migrations.** The `db:migrate` wrapper exits non-zero when `VERCEL_ENV=preview` and `DATABASE_URL_UNPOOLED` is unset or its host equals `PROD_DB_HOST`. The Preview-scope default `DATABASE_URL*` is unset or points at a throwaway `preview-default` Neon branch (documented in `docs/deploy.md`). `vercel-ignore-build.sh` also skips preview builds until the branch-scoped `NEON_PREVIEW_READY` env var exists, so the workflow's redeploy is the first real build. [CORRECTION 2026-09-29: that gate is removed; the integration writes a preview's `DATABASE_URL*` before its first build, and the guard is unchanged.]
7. **Copy afrikaburn's `dependabot.yml` as-is** (cooldown, `vitest` group, `@better-auth/*` ignore), dropping only pins that do not apply to us, and its commitlint `chore(deps): bump` ignore.

## Consequences

- Dependabot PRs have no preview URL. That is acceptable, because CI e2e runs against `next start`.
- To verify it: push a branch named `dependabot/test-guard` and confirm that no `preview/dependabot/*` Neon branch appears and that the Vercel deployment shows as "Ignored". Open a normal PR and confirm its first build either is skipped or logs a non-prod DB host. [CORRECTION 2026-09-29: the current checks are in `docs/SETUP.md`, "Vercel and Neon previews".]
