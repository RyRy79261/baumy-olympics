# Setup: things only the owner can do

Steps that need an account, a secret or admin rights on GitHub. Code that
depends on them is written to skip or fail closed until they are done, so CI
stays green in the meantime. Tick an item off here in the PR that finishes it.

## GitHub repository (issue #2)

- [ ] **Apply the `main` ruleset.** Needs `gh` signed in as a repo admin and
      `jq`:

  ```sh
  ./scripts/apply-github-ruleset.sh
  ```

  It creates (or updates, when re-run) the ruleset from
  `scripts/github-ruleset.json`: PR required, `CI pass` required (from GitHub
  Actions only), merge commits only, force pushes and branch deletion blocked,
  no bypass actors. Code-owner review is **not** required (single maintainer).
  It also turns off the squash and rebase merge buttons at the repository
  level. Check afterwards with
  `gh api repos/RyRy79261/baumy-olympics/rules/branches/main`.

- [ ] **Confirm Dependabot parsed its config.** After `.github/dependabot.yml`
      reaches `main`, open Insights → Dependency graph → Dependabot and check
      that both ecosystems (npm, github-actions) show no config error. Enable
      Dependabot alerts and security updates under Settings → Code security if
      they are off.

- [ ] **Watch better-auth by hand.** It is excluded from Dependabot on
      purpose (AGENTS.md "Security"), so subscribe to its releases and security
      advisories on GitHub.
