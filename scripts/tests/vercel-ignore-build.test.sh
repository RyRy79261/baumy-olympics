#!/usr/bin/env bash
# Tests for scripts/vercel-ignore-build.sh. Plain bash, no framework:
#
#   bash scripts/tests/vercel-ignore-build.test.sh
#
# Vercel's contract: exit 0 skips the build, exit 1 builds.
set -uo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/vercel-ignore-build.sh"
failures=0

# expect <name> <expected exit> [VAR=value ...]
# `env -i` so nothing from the caller's environment leaks into a case.
expect() {
  local name="$1" want="$2"
  shift 2
  local out got
  out="$(env -i PATH="$PATH" "$@" bash "$script" 2>&1)"
  got=$?
  if [ "$got" = "$want" ]; then
    echo "ok   - ${name} (exit ${got}): ${out%%$'\n'*}"
  else
    echo "FAIL - ${name}: expected exit ${want}, got ${got}"
    echo "       output: ${out}"
    failures=$((failures + 1))
  fi
}

SKIP=0
BUILD=1

expect "dependabot preview is skipped" "$SKIP" \
  VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=dependabot/npm_and_yarn/next-16.4.0
expect "dependabot/test-guard preview is skipped" "$SKIP" \
  VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=dependabot/test-guard
expect "normal preview builds (the Neon integration supplies its database)" "$BUILD" \
  VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feat/12-chores
expect "the retired NEON_PREVIEW_READY gate no longer skips a preview" "$BUILD" \
  VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feat/12-chores NEON_PREVIEW_READY=0
expect "a ref that merely contains dependabot builds" "$BUILD" \
  VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=fix/dependabot-config
expect "production builds" "$BUILD" \
  VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=main
expect "no VERCEL_ENV (local run) builds" "$BUILD"

if [ "$failures" -gt 0 ]; then
  echo "${failures} case(s) failed."
  exit 1
fi
echo "All vercel-ignore-build cases passed."
