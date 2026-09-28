#!/usr/bin/env bash
# Pins apps/web/vercel.json `git.deploymentEnabled` (issue #101): only `main`
# creates a Vercel deployment. Plain bash + jq (on the ubuntu runner):
#
#   bash scripts/tests/vercel-deployment-enabled.test.sh
#
# Vercel's rules (docs: project-configuration/git-configuration): keys are
# minimatch patterns, an unlisted branch defaults to true, and a branch that
# matches several keys deploys if at least one of them is true. So the config
# must be exactly {"**": false, "main": true}:
#   - "**" (not "*": in minimatch "*" stops at "/", so it misses "feat/x")
#     turns every branch off;
#   - "main": true turns production back on.
set -uo pipefail

config="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/apps/web/vercel.json"
failures=0

# check <name> <jq filter that must print "true">
check() {
  local name="$1" filter="$2" got
  got="$(jq -r "$filter" "$config" 2>&1)"
  if [ "$got" = "true" ]; then
    echo "ok   - ${name}"
  else
    echo "FAIL - ${name}: ${filter} gave ${got}"
    failures=$((failures + 1))
  fi
}

check "deploymentEnabled is an object of rules" \
  '.git.deploymentEnabled | type == "object"'
check "main deploys" \
  '.git.deploymentEnabled.main == true'
check "every other branch (any depth) is off" \
  '.git.deploymentEnabled["**"] == false'
check "no other rule (a stray true would re-enable previews)" \
  '.git.deploymentEnabled | keys == ["**", "main"]'
check "the production cron is still configured" \
  '[.crons[].path] | index("/api/cron/daily") != null'

if [ "$failures" -gt 0 ]; then
  echo "${failures} failure(s)"
  exit 1
fi
echo "all passed"
