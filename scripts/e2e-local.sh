#!/usr/bin/env bash
# Run the Playwright suite against the app on a real Docker Postgres, from cold.
# Ported from afrikaburn (origin/main:scripts/e2e-local.sh) and cut down to one
# app. CI runs exactly this script (.github/workflows/ci.yml, job `e2e`), so
# what a developer runs and what gates a merge cannot drift apart.
#
#   ./scripts/e2e-local.sh                        # whole suite, all projects
#   ./scripts/e2e-local.sh specs/smoke            # a slice (Playwright filter)
#   E2E_SERVE=build ./scripts/e2e-local.sh        # next build + next start
#   E2E_RESET_DB=1 ./scripts/e2e-local.sh         # start from an empty database
#   E2E_PROJECTS=desktop-chromium ./scripts/e2e-local.sh
#
# Needs Docker, pnpm and a Playwright Chromium
# (`pnpm --filter @baumy/web e2e:install`). No accounts or secrets: the
# database is local and external services are faked under E2E_TEST_MODE=1.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
COMPOSE=(docker compose -f docker-compose.local.yml)
PORT=3000
LOG_DIR="${TMPDIR:-/tmp}/baumy-e2e"
SERVER_LOG="$LOG_DIR/server.log"
mkdir -p "$LOG_DIR"

# The local stack (docker-compose.local.yml): NEON_LOCAL_PROXY=1 sends both Neon
# drivers to the proxies on localhost, whatever host the URL names.
export DATABASE_URL="postgres://postgres:postgres@localhost:54329/baumy"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export NEON_LOCAL_PROXY=1
# Test mode: the movable server clock and, later, the faked integrations.
# VERCEL_ENV is cleared so a shell that happens to carry it does not trip the
# boot guard (lib/test-mode.ts) here; on Vercel that guard is the point.
export E2E_TEST_MODE=1
unset VERCEL_ENV
# The only target the harness accepts (apps/web/e2e/lib/env.ts).
export E2E_BASE_URL="http://localhost:$PORT"

# 1. Database up, and wait until Postgres itself answers.
echo "==> database stack"
"${COMPOSE[@]}" up -d
ready=0
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d baumy >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "!! Postgres never became ready in 60s."
  "${COMPOSE[@]}" logs --no-color postgres | tail -30
  exit 1
fi

# 2. Optional reset. BOTH schemas: `drizzle` holds the migration tracker, so
# dropping only `public` leaves the migrator reporting "up to date" against an
# empty database.
if [ "${E2E_RESET_DB:-0}" = "1" ]; then
  echo "==> resetting database (public + drizzle)"
  "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d baumy \
    -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
fi

# 3. Migrate and seed. The household row is seeded by a migration today; a
# `db:seed` script in @baumy/db runs here as soon as one exists.
echo "==> migrations + seed"
pnpm db:local:migrate
pnpm --filter @baumy/db run --if-present db:seed

# 4. Free the port, by pid. Next renames its process to `next-server`, so a
# `pkill -f "next start"` misses the process that actually holds the port, and
# the readiness check below would then pass against a stale server.
port_holders() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u || true
  fi
}
for attempt in 1 2 3; do
  holders="$(port_holders)"
  [ -z "$holders" ] && break
  if [ "$attempt" = 3 ]; then
    echo "!! :$PORT is still held by pid(s) $holders after SIGTERM and SIGKILL."
    echo "   Refusing to run: the suite would test that server instead."
    exit 1
  fi
  echo "==> freeing :$PORT (pid(s) $holders)"
  # shellcheck disable=SC2086
  kill $([ "$attempt" = 2 ] && echo -9) $holders 2>/dev/null || true
  sleep 2
done

# 5. Serve. `build` (the CI default) tests the production bundle and avoids
# first-request compiles that look like timeouts; `dev` picks up edits.
E2E_SERVE="${E2E_SERVE:-$([ "${CI:-}" = "true" ] && echo build || echo dev)}"
echo "==> app on :$PORT (serve mode: $E2E_SERVE, log: $SERVER_LOG)"
if [ "$E2E_SERVE" = "build" ]; then
  pnpm exec turbo run build --filter=@baumy/web >"$LOG_DIR/build.log" 2>&1 || {
    echo "!! build failed:"
    tail -40 "$LOG_DIR/build.log"
    exit 1
  }
  pnpm --filter @baumy/web exec next start --port "$PORT" >"$SERVER_LOG" 2>&1 &
elif [ "$E2E_SERVE" = "dev" ]; then
  # Turbopack's dev state grows without bound across runs; start clean.
  rm -rf apps/web/.next/dev
  pnpm --filter @baumy/web exec next dev --port "$PORT" >"$SERVER_LOG" 2>&1 &
else
  echo "!! E2E_SERVE must be build or dev, not '$E2E_SERVE'."
  exit 1
fi
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  holders="$(port_holders)"
  # shellcheck disable=SC2086
  [ -n "$holders" ] && kill $holders 2>/dev/null || true
}
trap cleanup EXIT

# 6. Readiness. Fail loudly if the app never comes up, rather than letting
# every spec fail on a navigation timeout that looks like a product bug.
echo -n "    waiting for :$PORT"
ready=0
for _ in $(seq 1 90); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo " EXITED"
    echo "!! The server exited during startup. Last 40 lines of its log:"
    tail -40 "$SERVER_LOG"
    exit 1
  fi
  if curl -sf -o /dev/null "http://localhost:$PORT/api/health"; then
    echo " ok"
    ready=1
    break
  fi
  echo -n "."
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo " FAILED"
  echo "!! :$PORT never answered in 180s. Last 40 lines of the server log:"
  tail -40 "$SERVER_LOG"
  exit 1
fi

# 7. Playwright. Every project by default; narrow with E2E_PROJECTS.
PROJECT_ARGS=()
for project in ${E2E_PROJECTS:-desktop-chromium ipad-landscape mobile-360}; do
  PROJECT_ARGS+=("--project=$project")
done

echo "==> playwright"
cd "$ROOT/apps/web"
# Not `exec`: the EXIT trap must still stop the server afterwards.
pnpm exec playwright test "${PROJECT_ARGS[@]}" --workers="${E2E_WORKERS:-2}" "$@"
