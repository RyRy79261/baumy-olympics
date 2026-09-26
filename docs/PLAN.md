# Baumy Olympics: plan

Each item below is one GitHub issue and one PR, in order. Each milestone ends with the app deployable and `CI pass` green. The GitHub issues hold the full acceptance criteria; this file is the index. Items marked **[baumy-brain repo]** carry the `repo:baumy-brain` label and are filed and merged in `/home/ryan/repos/Personal/baumy-brain` (the live `@baumy_bot`, not the unrelated `baumy-bot` robot repo).

## M0: Foundation and CI

1. `chore(repo)`: scaffold the pnpm/turbo monorepo, the shared ts and eslint configs, prettier `format:check`, and commitlint with husky
2. `ci(repo)`: GitHub Actions CI with the `CI pass` gate, commitlint, coverage reporting, Dependabot config and the `main` ruleset
3. `feat(db)`: `packages/db` with the Neon drivers, local Docker Postgres, the PGlite harness and the platform tables
4. `test(e2e)`: Playwright harness, `scripts/e2e-local.sh`, the e2e CI job and the server test clock
5. `ci(repo)`: Vercel deploy with migrate-on-build (prod-host guard), Neon branch-per-PR, and Dependabot preview skipping (ADR 0004)

## M1: Auth and shell

6. `feat(auth)`: self-hosted Better Auth (email and password plus Google, fail-closed, bearer plugin, bare auth pages)
7. `feat(ui)`: pixel UI kit and app shell (tokens, fonts, header, nav with placeholder pages, PageHeading, Sprite)
8. `feat(web)`: action registry, `runAction`, gates, audit, idempotency and the UI adapter
9. `feat(auth)`: household membership gate, invite codes, the admin members page and `/settings` (as registry actions)
10. `feat(kiosk)`: kiosk device pairing, the kiosk shell, the avatar picker and PIN attestation

## M2: Chores game core

11. `feat(core)`: pure scoring engine (ruleset, points, replay, validate, time) with property tests
12. `feat(core)`: verification state machine and season standings
13. `feat(db)`: game schema and the transactional log-and-rescore write path
14. `feat(web)`: chores admin, seed chores (SPEC §4.7), and logging a completion on phone and kiosk
15. `feat(web)`: confirm, dispute and undo flows, and photo proof on Vercel Blob
16. `feat(web)`: scoreboard, streak board, season standings, pot tracker and prize mode
17. `feat(web)`: frequency tracking and weight suggestions with schedule and veto
18. `feat(web)`: daily cron and lazy sweep (status persist, season close, weight apply, photo prune)

## M3: Hub widgets

19. `feat(calendar)`: Google Calendar service-account client, the calendar page and calendar actions
20. `feat(web)`: notes, and the hub home dashboard

## M4: AI command and MCP

21. `feat(ai)`: Baumy command (typed): Claude tools generated from the registry, and the proposal review sheet
22. `feat(ai)`: voice input through Groq Whisper, and Baumy's sprite states (from `design/baumy-reference.png`)
23. `feat(mcp)`: MCP OAuth authorization server and the connections page
24. `feat(mcp)`: MCP server with read and write tools from the registry

## M5: Telegram and brain integration

25. `feat(brain)` **[baumy-brain repo]**: kitchen shopping API
26. `feat(web)`: shopping list page and widget, backed by the brain API
27. `feat(brain)`: `/api/v1/actions` service endpoint and Telegram member linking (Olympics side)
28. `feat(brain)` **[baumy-brain repo]**: Olympics client, `/link` command, and calendar and chore intents

## M6: Polish and kiosk

29. `feat(kiosk)`: PWA manifest, wake lock, idle reset, night mode and a sprite polish pass

## Dependency graph (short form)

- **M0:** 1 → 2 → 3 → 4 → 5.
- **M1:** 5 → 6. 7 needs 3. 8 needs 3 and 6. 9 needs 7 and 8. 10 needs 7, 8 and 9.
- **M2:** 11 can start straight after 1. 12 needs 11. 13 needs 3, 8, 11 and 12. 14 needs 8, 10 and 13. 15 needs 4 and 14. 16 and 17 need 14. 18 needs 15, 16 and 17.
- **M3:** 19 needs 8. 20 needs 16 and 19.
- **M4:** 21 needs 8, 14 and 16. 22 needs 21. 23 needs 8 and 9. 24 needs 14, 16 and 23.
- **M5:** 25 has no Olympics dependency. 26 needs 20, 21 and 25. 27 needs 8, 9 and 19. 28 needs 27.
- **M6:** 29 comes after 20.
