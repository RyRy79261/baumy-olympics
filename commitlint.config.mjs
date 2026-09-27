// Commit-message rules for Baumy Olympics. Copied from afrikaburn-contributors-app
// (origin/main:commitlint.config.mjs) with our scope list from AGENTS.md.
//
// Conventional Commits with a closed SCOPE list. Enforced locally by the husky
// `commit-msg` hook, and (from the CI issue on) over the PR title and every
// commit in the range, because PRs are merged rather than squashed and every
// commit lands on `main`.
//
// Keep `SCOPES` in step with AGENTS.md. A scope that is not listed fails, which
// is the point: a vocabulary nobody prunes stops meaning anything.
const SCOPES = [
  // apps/web and its surfaces
  "web",
  "kiosk",
  // packages/*
  "core",
  "db",
  "auth",
  "ui",
  "types",
  "ai",
  // surfaces and integrations inside apps/web
  "mcp",
  "brain",
  "calendar",
  // Playwright specs
  "e2e",
  // GitHub Actions
  "ci",
  // root-level: turbo, workspace tooling, docs about the repo itself
  "repo",
];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [2, "always", SCOPES],
    // 72, not the conventional default of 100: GitHub truncates list views
    // around there.
    "header-max-length": [2, "always", 72],
    // Bodies are prose explaining why; hard-wrapping a URL or a quoted error to
    // satisfy a linter makes the message worse. Warn rather than fail.
    "body-max-line-length": [1, "always", 100],
    "footer-max-line-length": [1, "always", 100],
  },
  // Bot-written headers that cannot be conventional or use our vocabulary:
  // GitHub merge commits, git-generated reverts, and Dependabot's
  // `chore(deps): bump …` / `chore(deps-dev): bump …` (its scope names no
  // workspace and a grouped update runs past 72 characters). Matched on the
  // exact bot form, not on `chore(deps)` in general.
  ignores: [
    (message) => /^Merge (branch|pull request|remote-tracking)/.test(message),
    (message) => /^Revert "/.test(message),
    (message) => /^chore\(deps(-dev)?\): bump /.test(message),
  ],
};
