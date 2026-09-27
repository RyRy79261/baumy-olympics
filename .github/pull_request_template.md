<!--
TITLE: Conventional Commits, see AGENTS.md "Git and PRs".
    type(scope): imperative subject, lowercase, no full stop, <=72 chars
    e.g. fix(core): keep a broken streak's penalty on the breaker
Scopes: web · kiosk · core · db · auth · ui · types · ai · mcp · brain ·
calendar · e2e · ci · repo.

Put "Closes #N" on its own line. KEEP THIS SHORT: a few lines per section.
Anything long goes in the <details> fold at the bottom.
-->

Closes #

## Why

<!-- 2-3 sentences. The user-visible effect, or what was broken. -->

## Decisions

<!-- Choices a reviewer might question, and the reference-repo path you copied
     from. "None." is a valid answer. -->

## Database

<!-- Migrations run on deploy. "None." is a real answer; say it.
     New migration: its number, whether it is additive, and exactly what any
     backfill touches. Destructive or irreversible: say so in the first line. -->

None.

## Testing

- [ ] `pnpm turbo run format:check lint typecheck test build`
- [ ] E2E areas run (`./scripts/e2e-local.sh specs/<area>`):
- [ ] Each new test was seen to fail with the code broken

## Risk

<!-- What breaks if this is wrong, and how someone would notice. -->

## Follow-ups

<!-- What this leaves for later, and any owner action it needs. "None." if it
     stands alone. -->

None.

<details>
<summary>Supplementary context</summary>

<!-- Optional. Delete if unused. -->

</details>
