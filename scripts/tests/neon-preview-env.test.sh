#!/usr/bin/env bash
# Tests for scripts/neon-preview-env.sh, offline: curl is replaced by
# scripts/tests/fake-bin/curl, which answers from canned Neon and Vercel JSON
# and logs every call. Needs bash and jq.
#
#   bash scripts/tests/neon-preview-env.test.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="${here}/../neon-preview-env.sh"
failures=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL - $1"
  [ -n "${2:-}" ] && printf '       %s\n' "$2"
  failures=$((failures + 1))
}
pass() { echo "ok   - $1"; }

SECRETS=(NEON_API_KEY=neon-key NEON_PROJECT_ID=proj-1 VERCEL_TOKEN=vercel-token
  VERCEL_ORG_ID=team_1 VERCEL_PROJECT_IDS=prj_web)

# run <case dir> [VAR=value ...]: runs the script with the fake curl; sets
# $out, $code and $log.
run() {
  local dir="$tmp/$1"
  shift
  mkdir -p "$dir/state"
  : > "$dir/log"
  out="$(env -i PATH="${here}/fake-bin:$PATH" FAKE_LOG="$dir/log" \
    FAKE_STATE="$dir/state" FAKE_ENVS='{"envs":[]}' "$@" bash "$script" 2>&1)"
  code=$?
  log="$(cat "$dir/log")"
}

# --- not configured ---------------------------------------------------------
run unconfigured HEAD_REF=feat/x
if [ "$code" = 0 ] && grep -q "not configured" <<<"$out" && [ -z "$log" ]; then
  pass "no secrets: exits 0 with a notice and calls nothing"
else
  fail "no secrets: expected exit 0, a notice and no calls (exit $code)" "$out"
fi

run partial HEAD_REF=feat/x NEON_API_KEY=k NEON_PROJECT_ID=p
if [ "$code" = 0 ] && grep -q "VERCEL_TOKEN" <<<"$out" && [ -z "$log" ]; then
  pass "some secrets: names the missing ones, exits 0, calls nothing"
else
  fail "some secrets: expected exit 0 naming VERCEL_TOKEN (exit $code)" "$out"
fi

run no-ref "${SECRETS[@]}"
if [ "$code" != 0 ] && [ -z "$log" ]; then
  pass "configured without HEAD_REF: fails before any call"
else
  fail "configured without HEAD_REF: expected a failure (exit $code)" "$out"
fi

# --- dependabot -------------------------------------------------------------
run dependabot "${SECRETS[@]}" HEAD_REF=dependabot/test-guard
if [ "$code" = 0 ] && [ -z "$log" ]; then
  pass "dependabot/test-guard: exits 0 and creates no Neon branch"
else
  fail "dependabot/test-guard: expected exit 0 with no calls (exit $code)" "$out"$'\n'"$log"
fi

# --- a new PR ---------------------------------------------------------------
run new-pr "${SECRETS[@]}" HEAD_REF=feat/12-chores HEAD_SHA=abc1234def GIT_REPO_ID=42
if [ "$code" != 0 ]; then
  fail "new PR: expected exit 0 (exit $code)" "$out"
else
  if grep -q '^POST https://console.neon.tech/api/v2/projects/proj-1/branches .*"name":"preview/feat/12-chores"' <<<"$log"; then
    pass "new PR: creates Neon branch preview/feat/12-chores"
  else
    fail "new PR: no branch create call for preview/feat/12-chores" "$log"
  fi
  keys="$(grep '^POST https://api.vercel.com/v10/projects/prj_web/env' <<<"$log" \
    | sed -E 's/^[^{]*//' | jq -r '"\(.key) \(.gitBranch) \(.target|join(","))"' | tr '\n' ';')"
  if [ "$keys" = "DATABASE_URL feat/12-chores preview;DATABASE_URL_UNPOOLED feat/12-chores preview;NEON_PREVIEW_READY feat/12-chores preview;" ]; then
    pass "new PR: writes both URLs, then NEON_PREVIEW_READY last, all branch-scoped Preview"
  else
    fail "new PR: unexpected env writes" "$keys"
  fi
  ready="$(grep '/v10/projects/prj_web/env' <<<"$log" | sed -E 's/^[^{]*//' \
    | jq -r 'select(.key=="NEON_PREVIEW_READY") | .value')"
  if [ "$ready" = 1 ]; then
    pass "new PR: NEON_PREVIEW_READY=1"
  else
    fail "new PR: NEON_PREVIEW_READY value was '$ready'"
  fi
  if grep -q '^POST https://api.vercel.com/v13/deployments?.*"sha":"abc1234def"' <<<"$log"; then
    pass "new PR: deploys the PR head from git"
  else
    fail "new PR: no git deploy of the head sha" "$log"
  fi
  if grep -q "TOPSECRET" <<<"$out"; then
    fail "new PR: the output contains the database password" "$out"
  elif grep -q "DATABASE_URL_UNPOOLED host: ep-preview-1.eu-central-1.aws.neon.tech" <<<"$out"; then
    pass "new PR: logs the preview host and never the password"
  else
    fail "new PR: expected the preview host in the output" "$out"
  fi
fi

# --- a later push to a wired PR ---------------------------------------------
wired='{"envs":[
  {"id":"e1","key":"DATABASE_URL","target":["preview"],"gitBranch":"feat/12-chores"},
  {"id":"e2","key":"DATABASE_URL_UNPOOLED","target":["preview"],"gitBranch":"feat/12-chores"},
  {"id":"e3","key":"NEON_PREVIEW_READY","target":["preview"],"gitBranch":"feat/12-chores"},
  {"id":"e4","key":"NEON_PREVIEW_READY","target":["preview"],"gitBranch":"other"}]}'
run wired "${SECRETS[@]}" HEAD_REF=feat/12-chores HEAD_SHA=abc GIT_REPO_ID=42 \
  FAKE_BRANCH_EXISTS=1 FAKE_ENVS="$wired"
if [ "$code" = 0 ] && grep -q "already in place" <<<"$out" \
  && ! grep -qE '^(POST|DELETE) ' <<<"$log"; then
  pass "wired PR: reuses the branch and writes or deploys nothing"
else
  fail "wired PR: expected no writes (exit $code)" "$out"$'\n'"$log"
fi

# Same branch, but the ready row is missing (e.g. a run cancelled half-way).
half='{"envs":[
  {"id":"e1","key":"DATABASE_URL","target":["preview"],"gitBranch":"feat/12-chores"},
  {"id":"e2","key":"DATABASE_URL_UNPOOLED","target":["preview"],"gitBranch":"feat/12-chores"},
  {"id":"e4","key":"NEON_PREVIEW_READY","target":["preview"],"gitBranch":"other"}]}'
run half "${SECRETS[@]}" HEAD_REF=feat/12-chores HEAD_SHA=abc GIT_REPO_ID=42 \
  FAKE_BRANCH_EXISTS=1 FAKE_ENVS="$half"
if [ "$code" = 0 ] \
  && ! grep -q '^POST https://console.neon.tech/api/v2/projects/proj-1/branches ' <<<"$log" \
  && grep -q '"key":"NEON_PREVIEW_READY"' <<<"$log" \
  && grep -q '^POST https://api.vercel.com/v13/deployments' <<<"$log"; then
  pass "half-wired PR: reuses the branch, rewrites the env and deploys"
else
  fail "half-wired PR: expected env rewrite and a deploy (exit $code)" "$out"$'\n'"$log"
fi

if [ "$failures" -gt 0 ]; then
  echo "${failures} case(s) failed."
  exit 1
fi
echo "All neon-preview-env cases passed."
