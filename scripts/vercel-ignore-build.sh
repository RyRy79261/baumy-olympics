#!/usr/bin/env bash
# Vercel "Ignored Build Step" for apps/web (apps/web/vercel.json
# `ignoreCommand`, ADR 0004). Vercel runs it from apps/web before every build.
#
#   exit 0  -> SKIP the build (Vercel shows the deployment as "Ignored")
#   exit 1  -> build
#
# `dependabot/*` refs never build: a dependency bump gets no preview, so the
# Vercel Neon integration makes no Neon branch for it. CI still runs the full
# suite against Docker Postgres. Everything else builds. Each preview gets its
# own `preview/<branch>` Neon branch and DATABASE_URL* from the integration
# (docs/deploy.md), and the migrate guard stops a preview migrating production.
#
# Reads only VERCEL_GIT_COMMIT_REF and VERCEL_ENV.

ref="${VERCEL_GIT_COMMIT_REF:-}"
env="${VERCEL_ENV:-}"

case "$ref" in
  dependabot/*)
    echo "Skipping: ${ref} is a Dependabot branch (ADR 0004)."
    exit 0
    ;;
esac

echo "Building: ${env:-unknown} ${ref}."
exit 1
