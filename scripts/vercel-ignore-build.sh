#!/usr/bin/env bash
# Vercel "Ignored Build Step" for apps/web (apps/web/vercel.json
# `ignoreCommand`, ADR 0004). Vercel runs it from apps/web before every build.
#
#   exit 0  -> SKIP the build (Vercel shows the deployment as "Ignored")
#   exit 1  -> build
#
# 1. `dependabot/*` refs never build. A dependency bump gets no preview and no
#    Neon branch; CI still runs the full suite against Docker Postgres.
# 2. Production always builds (and `vercel-build` migrates the prod database).
# 3. A preview builds only once its branch-scoped NEON_PREVIEW_READY=1 exists.
#    scripts/neon-preview-env.sh writes it after the preview's own Neon branch
#    and DATABASE_URL* are in place, then triggers a deploy. Without this the
#    git-triggered first build of a PR would run `db:migrate` against the
#    Preview-scope default database.
#
# Reads only VERCEL_GIT_COMMIT_REF, VERCEL_ENV and NEON_PREVIEW_READY.

ref="${VERCEL_GIT_COMMIT_REF:-}"
env="${VERCEL_ENV:-}"

case "$ref" in
  dependabot/*)
    echo "Skipping: ${ref} is a Dependabot branch (ADR 0004)."
    exit 0
    ;;
esac

if [ "$env" = "production" ]; then
  echo "Building: production."
  exit 1
fi

if [ "$env" = "preview" ] && [ "${NEON_PREVIEW_READY:-}" != "1" ]; then
  echo "Skipping: the Neon preview branch for ${ref:-this ref} is not wired yet (NEON_PREVIEW_READY is not 1)."
  echo "The neon-pr-preview workflow deploys again once it is. See docs/deploy.md."
  exit 0
fi

echo "Building: ${env:-unknown} ${ref}."
exit 1
