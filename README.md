# Baumy Olympics

A kitchen touchscreen hub for our household in Baumschulenweg, Berlin. It runs on an always-on iPad in the kitchen and on everyone's phone. It shows:

- **Chores game (the core).** Do a chore, log it, get points. Streaks pay more, breaking someone else's streak pays a bonus, and the year's points winner takes the whole savings pot. Streaks reset only on 1 Jan.
- **Shared calendar.** The house Google Calendar, edited through a service account created just for this house.
- **Shopping list.** Shared with Baumy on Telegram.
- **Notes.**
- **Baumy the cat.** A 16-bit pixel cat who takes typed or spoken commands. Claude chooses the action and you confirm it before anything runs.

Everything you can do in the UI (except admin actions, which stay UI only) you can also do through the Baumy command button, an MCP server (claude.ai and other chatbots) and the Baumy Telegram bot, which runs from [baumy-brain](../baumy-brain) (not the unrelated `baumy-bot` robot repo). All four go through one shared **action registry**.

## Stack

Next.js (App Router), React 19, Tailwind v4, Neon Postgres with Drizzle, self-hosted Better Auth, Vercel and Vercel Blob, the Google Calendar REST API through a service account, and Claude through `@anthropic-ai/sdk`. It is a pnpm and turbo monorepo.

## Docs

- [docs/SPEC.md](docs/SPEC.md): product and technical spec, including the scoring rules
- [docs/PLAN.md](docs/PLAN.md): milestones and the issue list
- [docs/decisions/](docs/decisions/): ADRs
- [AGENTS.md](AGENTS.md): how we work (read this before opening a PR)

## Status

Pre-M0. There is no code yet. See `docs/PLAN.md`.
