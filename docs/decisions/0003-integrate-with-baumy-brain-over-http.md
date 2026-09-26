# 0003: Integrate with baumy-brain over small HTTP APIs, in both directions

- Status: accepted (2026-09-27)

## Context

The owner mentioned both "Baumy bot" and "Baumy brain". The live Telegram bot (`@baumy_bot`) runs from **baumy-brain** (`/home/ryan/repos/Personal/baumy-brain`: Next.js, Neon, grammY and Inngest on Vercel), so that is the system this ADR integrates with. The GitHub repo `RyRy79261/baumy-bot` (`/home/ryan/repos/Personal/baumy-bot`) is unrelated: an unfinished ROS2 companion-robot prototype with no Telegram code. It is out of scope; a future robot could call the same MCP or action API.

Brain is the system of record for these, all scoped by its house `group_id`:

- the shopping list (`baumy_list_items`);
- reminders;
- the memory of dated facts.

It has no Google Calendar, no notes and no chores. The owner wants the bot to manage the calendar.

We considered three options:

1. **Shared database.** Rejected. Two Drizzle schemas pointing at one Neon database break whenever either side migrates. Brain's `maybe-migrate` runs on its own deploys, and its schema has rules we would have to copy (`group_id` scoping, normalisation, a partial unique index).
2. **Copy the data.** Rejected. The shopping list on the kiosk and in Telegram would drift apart.
3. **Each system owns its own domain and calls the other over HTTP.** Accepted.

## Decision

- **Brain owns** the shopping list, reminders and memory. **Olympics owns** chores, the game, the calendar integration and notes.
- **Olympics → brain:** a new brain route, `app/api/kitchen/shopping` (GET, plus POST `add` and `checkoff`).
  - It is authenticated by `KITCHEN_API_TOKEN`, compared in constant time as in `lib/telegram/verify.ts`.
  - The house is resolved on the brain side with `getHouseChatId(db)` from `lib/identity/house.ts` (honours the `BAUMY_HOUSE_CHAT_ID` override), never from the request. If it returns `''`, the API answers 503 `not_configured`.
  - It reuses `lib/lists/store.ts`.
  - Kitchen writes are recorded with `addedBy: null` or a fixed kitchen actor, until members can be mapped (see below).
- **Brain → Olympics:** `POST /api/v1/actions/{name}` (ADR 0002), sending `Bearer BRAIN_SERVICE_TOKEN` and `X-Baumy-Actor: tg:<telegram_user_id>`.
  - Olympics maps the actor through `members.telegram_user_id`.
  - Brain's LLM proposes and its deterministic code calls the endpoint, which keeps brain's "LLM proposes, code disposes" rule. For `confirm`-risk writes brain shows an inline confirm button first and sends `X-Baumy-Confirmed: 1`.
- **Member mapping:** `members.telegram_user_id`. An admin sets it in the UI, or a member creates a one-time code in `/settings` (8+ random characters, 10-minute TTL, single use) and sends `/link <code>` to brain, which calls `link_telegram`. That is the one action an unlinked tg id may call; the member comes from the code, not the header.

## Consequences

- Two repos have to change. The brain-side PRs (the kitchen shopping API, and the Olympics client with `/link` and the calendar and chore intents) are tracked as issues with the `repo:baumy-brain` label, filed in that repo.
- If brain is down, the kiosk shows the shopping list as "unavailable" and nothing else is affected. It never throws, following camp-404's result-union pattern.
- Brain could use the MCP server instead of the HTTP endpoint. We rejected that for v1, because brain wants a deterministic HTTP call, not an OAuth dance.
