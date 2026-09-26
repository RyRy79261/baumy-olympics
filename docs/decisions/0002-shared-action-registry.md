# 0002: One action registry for UI, AI command, MCP and baumy-brain

- Status: accepted (2026-09-27)

## Context

The owner's requirement is that everything a user can do in the UI can also be done by the Baumy command button (Claude), by chatbots over MCP and by the Telegram bot. intake-tracker only gets partway there:

- Its voice path shares the _client-side_ hooks with the UI.
- Its MCP server is read-only.

The reason is that its data is offline-first in Dexie. Olympics is server-authoritative, so it can go all the way.

## Decision

- Put every product capability in `apps/web/lib/actions/` as an `ActionDef`. SPEC §6.3 lists the fields: `name`, `description`, `consent`, `kind`, `risk`, `surfaces`, `requires`, a Zod `input`, `preview` and `execute`.
- `runAction()` is the **only** entry point, and it does these in order:
  1. checks the surface;
  2. validates with Zod;
  3. checks authorization (`requires` may depend on the parsed input);
  4. rate-limits;
  5. claims the idempotency key in `action_requests`;
  6. calls `execute`, then writes the audit row. `runAction` is the only writer of `audit_events` and `action_requests`, in the same transaction as the change, except for `transactional: false` actions (Google, brain), which run with no transaction open and are audited afterwards.
- The adapters are thin:
  - **UI:** server actions.
  - **AI command:** `z.toJSONSchema` becomes the Claude `tools`. Read tools run in the loop. Write tools come back as proposals, which a human approves in a review list (intake-tracker `components/voice/voice-panel.tsx`).
  - **MCP:** `server.registerTool` for each entry, gated by `baumy:read` / `baumy:write` scopes. The consent line is typed, so a tool cannot ship without one (intake-tracker `lib/mcp/tool-catalog.ts`).
  - **Brain:** `POST /api/v1/actions/{name}` with a service token and the actor's Telegram id.
- Admin actions (chore management, weights, point adjustments, pot, prize mode, members, kiosk pairing) have `surfaces: ["ui"]`. They are never exposed to the AI command, MCP or brain; the owner confirmed this on 2026-09-27 (SPEC §12), narrowing the original "everything through the AI button" brief. Destructive actions are never exposed over MCP or to brain.

## Consequences

- A new feature is "write the action, then write the button". The AI, MCP and brain get it for free, and each surface's exposure is decided explicitly by `surfaces`.
- The tool descriptions are part of the product, and they are covered by tests: a snapshot of the generated tool JSON, and a check that every name matches `^[a-z0-9_]{1,64}$`.
- Retries from the AI or MCP cannot double-count points, because every write needs a `requestId`.
