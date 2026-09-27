# 0004: Neon preview branches from a GitHub workflow, skipped for Dependabot

- Status: accepted (2026-09-27)

## Context

The owner remembered AfrikaBurn having "a trick to stop Dependabot creating Neon previews", and he was right. afrikaburn origin/main (added in ef65a4e, #65; still there at 46f0ed2) has:

- `.github/workflows/neon-pr-preview.yml`, whose job is guarded by `github.event.pull_request.user.login != 'dependabot[bot]'`, keyed on the PR author rather than `github.actor`.
- `neon-pr-cleanup.yml`, which uses `pull_request_target` so that it can still _delete_ a branch when a Dependabot PR closes.
- `.github/dependabot.yml` with a 2-day `cooldown`, a lockstep `vitest` group and `better-auth` / `@better-auth/*` ignores, and a commitlint ignore for `chore(deps): Bump …` (Dependabot capitalises `Bump`; the lower-case form is accepted too).

afrikaburn does not skip the Vercel build for Dependabot, so such a PR builds against the Preview env's default `DATABASE_URL*` ("in practice production, or nothing", its `docs/deploy.md`). The same happens on the _first_ build of every PR, because `neon-preview-env.sh` sets branch-scoped env vars and redeploys only after the git-triggered build has started. With migrate-on-build, that build would migrate the wrong database.

When the Neon branch quota fills up, every Vercel preview fails within about one second.

## Decision

1. **Use afrikaburn's workflow-based provisioning rather than the Vercel–Neon integration.** Copy `neon-pr-preview.yml`, `neon-pr-cleanup.yml` and `scripts/neon-preview-env.sh`. They run under `pull_request_target`, check out only the base branch, and exit 0 when secrets are missing.
2. **Copy afrikaburn's Dependabot guard, and add a `head.ref` check** to the preview job:
   ```yaml
   if: >
     github.event_name == 'workflow_dispatch' ||
     (github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.user.login != 'dependabot[bot]' &&
      !startsWith(github.event.pull_request.head.ref, 'dependabot/'))
   ```
3. **Skip the Vercel build for Dependabot branches.** In `apps/web/vercel.json`, set `"ignoreCommand": "bash ../../scripts/vercel-ignore-build.sh"`. The script exits 0 (skip) when `VERCEL_GIT_COMMIT_REF` starts with `dependabot/`, and exits 1 (build) otherwise.
4. **Dependabot PRs still run full CI.** CI uses Docker Postgres, not Neon, so dependency bumps are still tested.
5. **Keep the cleanup workflow unchanged**, as a safety net.
6. **Guard preview migrations.** The `db:migrate` wrapper exits non-zero when `VERCEL_ENV=preview` and `DATABASE_URL_UNPOOLED` is unset or its host equals `PROD_DB_HOST`. The Preview-scope default `DATABASE_URL*` is unset or points at a throwaway `preview-default` Neon branch (documented in `docs/deploy.md`). `vercel-ignore-build.sh` also skips preview builds until the branch-scoped `NEON_PREVIEW_READY` env var exists, so the workflow's redeploy is the first real build.
7. **Copy afrikaburn's `dependabot.yml` as-is** (cooldown, `vitest` group, `@better-auth/*` ignore), dropping only pins that do not apply to us, and its commitlint `chore(deps): bump` ignore.

## Consequences

- Dependabot PRs have no preview URL. That is acceptable, because CI e2e runs against `next start`.
- To verify it: push a branch named `dependabot/test-guard` and confirm that no `preview/dependabot/*` Neon branch appears and that the Vercel deployment shows as "Ignored". Open a normal PR and confirm its first build either is skipped or logs a non-prod DB host.
