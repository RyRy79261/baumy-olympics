#!/usr/bin/env bash
# Create (or reuse) a Neon branch `preview/<head ref>` and point the Vercel
# project's git-branch-scoped Preview env at it, then mark the branch ready and
# deploy it.
#
# Copied from afrikaburn-contributors-app (origin/main:scripts/neon-preview-env.sh)
# per ADR 0004. Changes from that copy:
#   - one Vercel project (apps/web) rather than three; VERCEL_PROJECT_IDS is
#     still a comma-separated list so a second app needs no script change;
#   - after DATABASE_URL and DATABASE_URL_UNPOOLED it writes a branch-scoped
#     NEON_PREVIEW_READY=1. scripts/vercel-ignore-build.sh skips preview builds
#     until that exists, so the deploy this script triggers is the PR's first
#     real build, and no build ever migrates the Preview-scope default database;
#   - it deploys the PR head from git (gitSource) when HEAD_SHA and GIT_REPO_ID
#     are given, because the git-triggered deployment was Ignored; it falls
#     back to redeploying the branch's latest deployment otherwise;
#   - when the branch is reused and all three env rows already exist, it
#     changes nothing: the git-triggered build of that push already has them,
#     and rewriting the rows would open a window in which that build is skipped.
#
# Required env:
#   NEON_API_KEY
#   NEON_PROJECT_ID
#   VERCEL_TOKEN
#   VERCEL_ORG_ID                          (team_…)
#   VERCEL_PROJECT_IDS                     (comma-separated prj_… list)
#   HEAD_REF                               (git head branch name)
#
# Optional:
#   HEAD_SHA, GIT_REPO_ID                  deploy this exact commit from git
#   NEON_DATABASE                          default: first non-system db
#   NEON_ROLE                              default: first login role on branch
#   DRY_RUN=1                              print actions only
#   SKIP_REDEPLOY=1                        do not trigger Vercel deploys
#
# Never logs a connection string, only its host.
set -euo pipefail

# NOT CONFIGURED IS NOT AN ERROR. This wiring is opt-in: until the five
# secrets exist the script exits 0 with a notice, so landing it does not turn
# every pull request red. Missing HEAD_REF *is* an error: that means the
# caller is broken, not unconfigured.
missing=""
for n in NEON_API_KEY NEON_PROJECT_ID VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_IDS; do
  if [ -z "${!n:-}" ]; then
    missing="${missing} ${n}"
  fi
done
if [ -n "$missing" ]; then
  echo "::notice::Neon preview wiring is not configured (missing:${missing}), skipping."
  echo "Set these repository secrets to enable it; see docs/deploy.md."
  exit 0
fi

if [ -z "${HEAD_REF:-}" ]; then
  echo "::error::HEAD_REF is empty: the caller did not pass a git branch name" >&2
  exit 1
fi

# Belt and braces with the workflow's `if:` (ADR 0004): never for Dependabot.
case "$HEAD_REF" in
  dependabot/*)
    echo "::notice::${HEAD_REF} is a Dependabot branch: no Neon preview branch (ADR 0004)."
    exit 0
    ;;
esac

DRY_RUN="${DRY_RUN:-0}"
SKIP_REDEPLOY="${SKIP_REDEPLOY:-0}"
BRANCH_NAME="preview/${HEAD_REF}"
READY_KEY="NEON_PREVIEW_READY"

neon_api="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}"
vercel_api="https://api.vercel.com"
auth_neon=( -H "Authorization: Bearer ${NEON_API_KEY}" -H "Accept: application/json" -H "Content-Type: application/json" )
auth_vercel=( -H "Authorization: Bearer ${VERCEL_TOKEN}" -H "Accept: application/json" -H "Content-Type: application/json" )
curl_opts=( --connect-timeout 10 --max-time 60 --retry 3 --retry-delay 3 )

echo "Neon branch target: ${BRANCH_NAME}"
echo "Vercel projects: ${VERCEL_PROJECT_IDS}"

neon_get() {
  local path="$1"
  curl -sS "${curl_opts[@]}" "${auth_neon[@]}" "${neon_api}${path}"
}

neon_post() {
  local path="$1"
  local body="$2"
  curl -sS "${curl_opts[@]}" "${auth_neon[@]}" -d "$body" "${neon_api}${path}"
}

vercel_get() {
  local path="$1"
  curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" "${vercel_api}${path}?teamId=${VERCEL_ORG_ID}"
}

vercel_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" -X "$method" -d "$body" \
      "${vercel_api}${path}?teamId=${VERCEL_ORG_ID}"
  else
    curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" -X "$method" \
      "${vercel_api}${path}?teamId=${VERCEL_ORG_ID}"
  fi
}

IFS=',' read -r -a project_ids <<< "$VERCEL_PROJECT_IDS"

# --- Neon: find or create branch ------------------------------------------------

branches_json="$(neon_get "/branches?limit=10000")"
if ! printf '%s' "$branches_json" | jq -e '.branches' >/dev/null 2>&1; then
  # The body is not echoed: an error from Neon is fine, but this is also the
  # path a proxy or HTML error page takes, and none of it is needed to act.
  echo "::error::failed to list Neon branches (is NEON_PROJECT_ID right, or is the branch quota full? see docs/deploy.md)" >&2
  exit 1
fi

primary_id="$(printf '%s' "$branches_json" | jq -r '.branches[] | select(.primary == true) | .id' | head -n1)"
if [ -z "$primary_id" ] || [ "$primary_id" = "null" ]; then
  echo "::error::no primary Neon branch found" >&2
  exit 1
fi
echo "Neon primary branch id: ${primary_id}"

branch_id="$(printf '%s' "$branches_json" | jq -r --arg n "$BRANCH_NAME" \
  '.branches[] | select(.name == $n) | .id' | head -n1)"
branch_created=0

if [ -z "$branch_id" ] || [ "$branch_id" = "null" ]; then
  echo "Creating Neon branch ${BRANCH_NAME} from primary…"
  branch_created=1
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY_RUN: would POST /branches name=${BRANCH_NAME} parent=${primary_id} + read_write endpoint"
    branch_id="dry-run-branch"
  else
    # Neon creates branches WITHOUT a compute unless `endpoints` is set
    # (API: "If omitted, the branch is created without any compute endpoint").
    # That yields permanent "endpoint not found" on connection_uri, not a brief
    # race. Always request a read_write endpoint with the branch.
    create_body="$(jq -n --arg name "$BRANCH_NAME" --arg parent "$primary_id" \
      '{branch:{name:$name,parent_id:$parent},endpoints:[{type:"read_write"}]}')"
    create_resp="$(neon_post "/branches" "$create_body")"
    branch_id="$(printf '%s' "$create_resp" | jq -r '.branch.id // empty')"
    if [ -z "$branch_id" ]; then
      # Race: another runner created it. Re-list.
      branches_json="$(neon_get "/branches?limit=10000")"
      branch_id="$(printf '%s' "$branches_json" | jq -r --arg n "$BRANCH_NAME" \
        '.branches[] | select(.name == $n) | .id' | head -n1)"
    fi
    if [ -z "$branch_id" ] || [ "$branch_id" = "null" ]; then
      # A full branch quota lands here. Print Neon's message only, never the
      # whole response (it can carry connection details).
      echo "::error::failed to create or find Neon branch ${BRANCH_NAME}: $(printf '%s' "${create_resp:-}" | jq -r '.message // "no message"' 2>/dev/null || echo 'unparseable response')" >&2
      exit 1
    fi
  fi
else
  echo "Reusing existing Neon branch id: ${branch_id}"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN: skipping connection URI fetch and Vercel updates"
  exit 0
fi

# --- Already wired? ------------------------------------------------------------

# branch_keys <env list json>: the Preview keys this git branch already has.
branch_keys() {
  printf '%s' "$1" | jq -r --arg branch "$HEAD_REF" '
    [.envs[]?
      | select((.target // []) | index("preview"))
      | select((.gitBranch // "") == $branch)
      | .key] | unique | join(",")
  '
}

already_wired=1
if [ "$branch_created" = "1" ]; then
  already_wired=0
else
  for project_id in "${project_ids[@]}"; do
    project_id="$(echo "$project_id" | tr -d '[:space:]')"
    [ -z "$project_id" ] && continue
    keys=",$(branch_keys "$(vercel_get "/v9/projects/${project_id}/env")"),"
    for k in DATABASE_URL DATABASE_URL_UNPOOLED "$READY_KEY"; do
      case "$keys" in
        *",${k},"*) ;;
        *) already_wired=0 ;;
      esac
    done
  done
fi

if [ "$already_wired" = "1" ]; then
  echo "Neon branch ${BRANCH_NAME} and its Preview env are already in place; this push's git build uses them. Nothing to do."
  exit 0
fi

# Branches created before this script requested an endpoint (or created without
# one) have no compute. Ensure a read_write endpoint exists, then wait until it
# is past "init" before connection_uri.
endpoint_id_for_branch() {
  local endpoints_json="$1"
  printf '%s' "$endpoints_json" | jq -r --arg bid "$branch_id" '
    [.endpoints[]? | select(.branch_id == $bid) | .id][0] // empty
  '
}

ensure_neon_endpoint() {
  local endpoints_json existing create_ep_body create_ep_resp new_id

  endpoints_json="$(neon_get "/endpoints")"
  existing="$(endpoint_id_for_branch "$endpoints_json")"
  if [ -n "$existing" ]; then
    echo "Neon endpoint already present for branch: ${existing}"
    return 0
  fi

  echo "No compute on branch ${branch_id}; creating read_write endpoint…"
  create_ep_body="$(jq -n --arg bid "$branch_id" \
    '{endpoint:{branch_id:$bid,type:"read_write"}}')"
  create_ep_resp="$(neon_post "/endpoints" "$create_ep_body")"
  new_id="$(printf '%s' "$create_ep_resp" | jq -r '.endpoint.id // empty')"
  if [ -z "$new_id" ]; then
    # Another runner may have won the race. Re-list once.
    endpoints_json="$(neon_get "/endpoints")"
    new_id="$(endpoint_id_for_branch "$endpoints_json")"
  fi
  if [ -z "$new_id" ]; then
    echo "::error::failed to create Neon endpoint for branch ${branch_id}: $(printf '%s' "$create_ep_resp" | jq -r '.message // "no message"' 2>/dev/null || echo 'unparseable response')" >&2
    exit 1
  fi
  echo "Created Neon endpoint: ${new_id}"
}

wait_for_neon_endpoint() {
  local deadline=$((SECONDS + 180))
  local endpoints_json endpoint_id endpoint_state

  while (( SECONDS < deadline )); do
    endpoints_json="$(neon_get "/endpoints")"
    if ! printf '%s' "$endpoints_json" | jq -e '.endpoints' >/dev/null 2>&1; then
      echo "Waiting for Neon endpoints list for branch ${branch_id}…"
      sleep 5
      continue
    fi

    # Prefer an endpoint that has left "init" (provisioned: idle or active).
    endpoint_id="$(printf '%s' "$endpoints_json" | jq -r --arg bid "$branch_id" '
      [.endpoints[]?
        | select(.branch_id == $bid)
        | select((.current_state // .state // "") != "init")
        | .id
      ][0] // empty
    ')"
    endpoint_state="$(printf '%s' "$endpoints_json" | jq -r --arg bid "$branch_id" --arg eid "$endpoint_id" '
      [.endpoints[]?
        | select(.branch_id == $bid)
        | select(.id == $eid)
        | (.current_state // .state // "")
      ][0] // empty
    ')"

    if [ -n "$endpoint_id" ]; then
      echo "Neon endpoint ready: ${endpoint_id} (state=${endpoint_state:-unknown})"
      return 0
    fi

    endpoint_id="$(endpoint_id_for_branch "$endpoints_json")"
    if [ -n "$endpoint_id" ]; then
      echo "Neon endpoint ${endpoint_id} still initializing for branch ${branch_id}…"
    else
      echo "Waiting for Neon endpoint to become ready for branch ${branch_id}…"
    fi
    sleep 5
  done

  echo "::error::Neon endpoint never became ready for branch ${branch_id}" >&2
  exit 1
}

ensure_neon_endpoint
wait_for_neon_endpoint

# --- Neon: connection URIs ------------------------------------------------------

if [ -z "${NEON_DATABASE:-}" ]; then
  dbs_json="$(neon_get "/branches/${branch_id}/databases")"
  NEON_DATABASE="$(printf '%s' "$dbs_json" | jq -r \
    '[.databases[]? | select(.name != "postgres")][0].name // .databases[0].name // empty')"
fi
if [ -z "${NEON_ROLE:-}" ]; then
  roles_json="$(neon_get "/branches/${branch_id}/roles")"
  NEON_ROLE="$(printf '%s' "$roles_json" | jq -r \
    '[.roles[]? | select(.protected != true)][0].name // .roles[0].name // empty')"
fi
if [ -z "$NEON_DATABASE" ] || [ -z "$NEON_ROLE" ]; then
  echo "::error::could not resolve NEON_DATABASE/NEON_ROLE (got db='${NEON_DATABASE:-}' role='${NEON_ROLE:-}')" >&2
  exit 1
fi
echo "Using database=${NEON_DATABASE} role=${NEON_ROLE}"

uri_for() {
  local pooled="$1" # true|false
  local resp uri attempt
  for attempt in $(seq 1 20); do
    resp="$(curl -sS "${curl_opts[@]}" "${auth_neon[@]}" \
      "${neon_api}/connection_uri?branch_id=${branch_id}&database_name=${NEON_DATABASE}&role_name=${NEON_ROLE}&pooled=${pooled}")"
    uri="$(printf '%s' "$resp" | jq -r '.uri // empty')"

    if [ -n "$uri" ] && [ "$uri" != "null" ]; then
      printf '%s' "$uri"
      return 0
    fi

    if printf '%s' "$resp" | jq -e '
      (.message // "") | test("endpoint not found|not ready"; "i")
    ' >/dev/null 2>&1; then
      echo "Neon endpoint not ready for connection_uri pooled=${pooled}; retrying (${attempt}/20)…" >&2
      sleep 5
      continue
    fi

    echo "::error::failed to fetch connection_uri pooled=${pooled}: $(printf '%s' "$resp" | jq -r '.message // "no message"' 2>/dev/null || echo 'unparseable response')" >&2
    exit 1
  done

  echo "::error::timed out waiting for Neon connection_uri pooled=${pooled}" >&2
  exit 1
}

DATABASE_URL="$(uri_for true)"
DATABASE_URL_UNPOOLED="$(uri_for false)"
# Mask them in the Actions log as a second line of defence.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::${DATABASE_URL}"
  echo "::add-mask::${DATABASE_URL_UNPOOLED}"
fi

# Host-only log (never log the full URI: it contains the password).
host_of() {
  printf '%s' "$1" | sed -nE 's#^postgres(ql)?://[^@]+@([^/?:]+).*#\2#p' | grep . || printf '(unknown-host)'
}
echo "DATABASE_URL host: $(host_of "$DATABASE_URL")"
echo "DATABASE_URL_UNPOOLED host: $(host_of "$DATABASE_URL_UNPOOLED")"

# --- Vercel: upsert git-branch-scoped Preview env ------------------------------

upsert_env() {
  local project_id="$1"
  local key="$2"
  local value="$3"

  local list
  list="$(vercel_get "/v9/projects/${project_id}/env")"
  local existing_ids
  existing_ids="$(printf '%s' "$list" | jq -r --arg key "$key" --arg branch "$HEAD_REF" '
    .envs[]?
    | select(.key == $key)
    | select((.target // []) | index("preview"))
    | select((.gitBranch // "") == $branch)
    | .id
  ')"

  if [ -n "$existing_ids" ]; then
    while IFS= read -r eid; do
      [ -z "$eid" ] && continue
      echo "  deleting existing ${key} id=${eid}"
      vercel_json DELETE "/v9/projects/${project_id}/env/${eid}" >/dev/null
    done <<< "$existing_ids"
  fi

  local body
  body="$(jq -n --arg key "$key" --arg value "$value" --arg branch "$HEAD_REF" \
    '{key:$key, value:$value, type:"encrypted", target:["preview"], gitBranch:$branch}')"
  echo "  creating ${key} for preview gitBranch=${HEAD_REF}"
  local created
  created="$(vercel_json POST "/v10/projects/${project_id}/env" "$body")"
  if ! printf '%s' "$created" | jq -e '(.created // .id // .key) and (.error | not)' >/dev/null 2>&1; then
    echo "::error::failed to create ${key} on ${project_id}: $(printf '%s' "$created" | jq -r '.error.message // "no message"' 2>/dev/null || echo 'unparseable response')" >&2
    exit 1
  fi
}

for project_id in "${project_ids[@]}"; do
  project_id="$(echo "$project_id" | tr -d '[:space:]')"
  [ -z "$project_id" ] && continue
  echo "Updating Vercel project ${project_id}…"
  upsert_env "$project_id" "DATABASE_URL" "$DATABASE_URL"
  upsert_env "$project_id" "DATABASE_URL_UNPOOLED" "$DATABASE_URL_UNPOOLED"
  # Last, so "ready" always means the two rows above are in place.
  upsert_env "$project_id" "$READY_KEY" "1"
done

# --- Vercel: deploy this git branch --------------------------------------------

if [ "$SKIP_REDEPLOY" = "1" ]; then
  echo "SKIP_REDEPLOY=1: not triggering deploys"
  exit 0
fi

# The git-triggered deployment for this push was Ignored (no NEON_PREVIEW_READY
# yet), so build the PR head from git now.
deploy_from_git() {
  local project_id="$1"
  local name resp new_id
  name="$(vercel_get "/v9/projects/${project_id}" | jq -r '.name // empty')"
  if [ -z "$name" ]; then
    echo "  warning: could not read the name of ${project_id}"
    return 1
  fi
  resp="$(vercel_json POST "/v13/deployments" "$(jq -n \
    --arg name "$name" --arg project "$project_id" --arg ref "$HEAD_REF" \
    --arg sha "$HEAD_SHA" --arg repoId "$GIT_REPO_ID" \
    '{name:$name, project:$project,
      gitSource:{type:"github", repoId:$repoId, ref:$ref, sha:$sha}}')" || true)"
  new_id="$(printf '%s' "$resp" | jq -r '.id // empty' 2>/dev/null || true)"
  if [ -z "$new_id" ]; then
    echo "  warning: git deploy was not accepted: $(printf '%s' "$resp" | jq -r '.error.message // "no message"' 2>/dev/null || echo 'unparseable response')"
    return 1
  fi
  echo "  new deployment from ${HEAD_REF}@${HEAD_SHA:0:7}: ${new_id}"
}

# Fallback (workflow_dispatch has no sha): redeploy the branch's latest
# preview deployment, as afrikaburn does.
redeploy_latest() {
  local project_id="$1"
  local deps dep_id resp new_id

  deps="$(curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" \
    "${vercel_api}/v6/deployments?projectId=${project_id}&limit=30&teamId=${VERCEL_ORG_ID}" || true)"
  if ! printf '%s' "$deps" | jq -e '.deployments' >/dev/null 2>&1; then
    echo "  warning: could not list deployments for ${project_id}; push again to build"
    return 0
  fi

  dep_id="$(printf '%s' "$deps" | jq -r --arg ref "$HEAD_REF" '
    [.deployments[]?
      | select((.meta.gitBranch // .meta.githubCommitRef // "") == $ref)
      | select((.target // "") != "production")
    ][0].uid // empty
  ' || true)"
  if [ -z "${dep_id}" ]; then
    echo "  no preview deployment for ${HEAD_REF} on ${project_id}; the next push will build"
    return 0
  fi

  resp="$(curl -sS "${curl_opts[@]}" "${auth_vercel[@]}" -X POST \
    -d "$(jq -n --arg id "$dep_id" '{deploymentId:$id}')" \
    "${vercel_api}/v13/deployments?teamId=${VERCEL_ORG_ID}&forceNew=1" || true)"
  new_id="$(printf '%s' "$resp" | jq -r '.id // .uid // empty' 2>/dev/null || true)"
  if [ -z "${new_id}" ]; then
    echo "  warning: redeploy of ${dep_id} was not accepted; the next push will build"
  else
    echo "  redeployed ${dep_id} as ${new_id}"
  fi
}

for project_id in "${project_ids[@]}"; do
  project_id="$(echo "$project_id" | tr -d '[:space:]')"
  [ -z "$project_id" ] && continue
  if [ -n "${HEAD_SHA:-}" ] && [ -n "${GIT_REPO_ID:-}" ] && deploy_from_git "$project_id"; then
    continue
  fi
  redeploy_latest "$project_id"
done

echo "Done. Neon branch ${BRANCH_NAME} (${branch_id}) wired to Preview for ${HEAD_REF}."
