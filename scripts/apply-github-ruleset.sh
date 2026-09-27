#!/usr/bin/env bash
# Create or update the `main` ruleset from scripts/github-ruleset.json, and
# turn off the squash and rebase merge buttons at the repository level too.
# Idempotent: re-run it after editing the JSON. Needs `gh` signed in as a repo
# admin. See docs/SETUP.md.
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
here="$(cd "$(dirname "$0")" && pwd)"
json="$here/github-ruleset.json"
name="$(jq -r .name "$json")"

id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
if [ -n "$id" ]; then
  gh api -X PUT "repos/$repo/rulesets/$id" --input "$json" --jq '"updated ruleset \(.name) (#\(.id))"'
else
  gh api -X POST "repos/$repo/rulesets" --input "$json" --jq '"created ruleset \(.name) (#\(.id))"'
fi

gh api -X PATCH "repos/$repo" \
  -F allow_merge_commit=true -F allow_squash_merge=false -F allow_rebase_merge=false \
  --jq '"merge commit: \(.allow_merge_commit), squash: \(.allow_squash_merge), rebase: \(.allow_rebase_merge)"'
