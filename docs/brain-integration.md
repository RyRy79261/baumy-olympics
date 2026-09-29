# Brain → Olympics: the `/api/v1/actions` endpoint

baumy-brain (the Telegram bot `@baumy_bot`) manages the calendar, chores and
notes through Olympics' action registry (ADR 0003, SPEC §6.3 and §6.6,
issue #27). This page is the contract brain codes against. The code is
`apps/web/lib/brain/endpoint.ts`; every call ends in `runAction` with
`source: "brain"`, so brain gets exactly the checks, idempotency and audit
trail the UI gets.

The long form for brain's agent (the household model, every action with
examples and what to say back) is
[`docs/brain-operations-spec.md`](brain-operations-spec.md), generated from
the registry by `pnpm brain:spec`. Brain keeps a copy as
`docs/olympics-operations-spec.md`.

## Endpoints

| Method | Path                     | What it does                                                                                              |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/actions`        | `{ok: true, actions: [{name, title, description, input_schema, kind, risk, member_field?}]}`: brain tools |
| `POST` | `/api/v1/actions/{name}` | Runs one action. The JSON body is its input (an empty body is `{}`).                                      |

`GET` needs only the token. The list is `toolSpecs("brain")`: every action
whose `surfaces` include `brain`. Since 2026-09-28 (issue #70) that is every
member action, the `destructive` ones included, but no admin one except
`create_bounty`, `update_bounty` and `add_pot_contribution` (issue #107,
SPEC §12 decision 10 as amended 2026-09-29), which run only for a linked admin
in their own name (`own_word_only` and `admin_only`), behind the confirm button.
`admin_only` (added 2026-09-29, PR #110) is set on an action only a household
admin may run.
`member_field` is set when the action names the member it is done for in its
own input (`log_completion`'s `doneBy`). `input_schema` is JSON Schema (the Zod input side), ready to become an
LLM tool. It is snapshotted in
`apps/web/lib/actions/__snapshots__/tool-specs.brain.json`, so a change to it
shows up in review.

## Headers

| Header                              | When         | Meaning                                                                                                                   |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <token>`     | always       | The service token (`BRAIN_SERVICE_TOKEN` in brain's env). Looked up by its sha256 and compared in constant time.          |
| `X-Baumy-Actor: tg:<telegram id>`   | every `POST` | The Telegram user brain acts for. Mapped to an active member through `members.telegram_user_id` on every call.            |
| `X-Baumy-On-Behalf-Of: <member id>` | optional     | Run the action as this housemate (below).                                                                                 |
| `X-Baumy-Confirmed: 1`              | see below    | Send it only after the person tapped brain's inline confirm button. Anything else than `1` counts as not confirmed.       |
| `Idempotency-Key: <key>`            | every write  | 8 to 128 of `A-Z a-z 0-9 . _ : -`, one per intended action (a UUID). Used as the `requestId`; a retry sends the same key. |

Reads need no `Idempotency-Key`; a read sent with one ignores it.

## The `risk` / confirm rule

Each tool carries `risk`:

- `safe` (for example `create_note`, `link_telegram`, every read): brain may
  run it straight from the conversation.
- `confirm` (for example `create_event`, `update_event`, `log_completion`,
  `confirm_completion`, `dispute_completion`, `dismiss_reminder`,
  `approve_login`, whose confirm button is the number the member taps in
  the sign-in DM, below): brain shows
  an inline confirm button with what it is about to do, and sends the call
  with `X-Baumy-Confirmed: 1` only after the tap. Without the header the
  answer is 428 `CONFIRMATION_REQUIRED` and nothing runs.
- `destructive` (`delete_event`, `delete_note`): exactly like `confirm`
  (owner ruling 2026-09-28, issue #70). The card names the exact thing that
  goes.
- Any write with `X-Baumy-On-Behalf-Of` needs the tap too, even a `safe` one.
  Reads never do.

Admin actions (`manage_members`, `manage_chore`, `adjust_points`,
`schedule_weight`, …) and the account's own settings stay in the app:
calling one answers 403 `SURFACE_FORBIDDEN`.

Brain's own rule stays: the LLM proposes, deterministic code calls this
endpoint.

## Acting on a housemate's behalf

Owner ruling 2026-09-28 (issue #70): "Baumy can act on behalf of
housemates." Ryan in Telegram says "mark the plumber reminder seen for Sam";
brain sends `X-Baumy-On-Behalf-Of: <Sam's member id>` with Ryan in
`X-Baumy-Actor`.

- Sam must be an active member of this household, else 404 `NOT_FOUND`. A
  malformed id is 400 `INVALID_INPUT`.
- The action runs as Sam: his permissions, his idempotency ledger, his
  answer. The audit row has `actor_member_id` = Sam and
  `initiated_by_member_id` = Ryan, `source=brain`.
- A write on Sam's behalf needs `X-Baumy-Confirmed: 1` (Ryan's tap), even a
  `safe` one. A read does not.
- Sam's id equal to Ryan's own counts as no header, for every action:
  the refusals below apply only to someone else's id.
- Refused with 400 for `link_telegram` (always the sender) and for an action
  with a `member_field`: "Jo did the dishes" is `log_completion` with
  `doneBy: <Jo's id>`, which Ryan logs and vouches for. On-behalf would
  record that Jo logged it herself.
- Never for someone's own word: the claim events (`confirm_completion`,
  `dispute_completion`, `undo_completion`, `withdraw_dispute`,
  `concede_completion`, marked `own_word_only` in the tool list) answer 403
  `FORBIDDEN` on anyone's behalf, before the confirm check, so nobody can
  confirm their own claim by speaking as a housemate. The sign-in answers
  (`approve_login`, `deny_login`) are `own_word_only` too. Everything
  else, notes included, works on a housemate's behalf.
- Admin actions stay unavailable, on anyone's behalf: the three brain gets
  (`admin_only` in the tool list) answer 403 `FORBIDDEN` "Admin changes can't
  be made on someone's behalf. Ask an admin to do it themself."
- Brain can read member ids from `list_reminders` (`members`) or
  `get_standings`.

## Answers and error codes

A success is `200 {ok: true, data}`. A failure is
`{ok: false, code, message}`, plus `issues` (with `INVALID_INPUT`), `retryAt`
(with `COOLDOWN`) or `retryAfterSeconds` (with `RATE_LIMITED`, also sent as
`Retry-After`). `message` is a sentence brain can show the person as it is.

| Status | `code`                                                                         | Meaning                                                                                          |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 400    | `INVALID_INPUT`                                                                | The body, `X-Baumy-Actor` or `Idempotency-Key` is missing or wrong; `issues` says which field.   |
| 401    | `UNAUTHENTICATED`                                                              | The token is missing, unknown or revoked.                                                        |
| 403    | `FORBIDDEN`                                                                    | The token lacks the `brain` scope, or the actor may not do this.                                 |
| 403    | `SURFACE_FORBIDDEN`                                                            | The action exists but is not brain's (admin or UI only).                                         |
| 403    | `TELEGRAM_NOT_LINKED`                                                          | The Telegram user is not linked to a member. Tell them to send `/link <code>` (below).           |
| 404    | `UNKNOWN_ACTION`, `NOT_FOUND`                                                  | No such action; or the thing it names (an event, a chore, the on-behalf housemate) is not there. |
| 409    | `IDEMPOTENCY_CONFLICT`                                                         | This `Idempotency-Key` was already used with a different input or action.                        |
| 409    | `IN_PROGRESS`                                                                  | The same key is still running; ask again in a moment.                                            |
| 422    | `LINK_CODE_INVALID`, `TELEGRAM_ALREADY_LINKED`, `COOLDOWN`, `INVALID_STATE`, … | The action understood the request and said no. Show `message`.                                   |
| 428    | `CONFIRMATION_REQUIRED`                                                        | A `confirm` or `destructive` action, or a write on someone's behalf, without the header.         |
| 429    | `RATE_LIMITED`                                                                 | Too many calls; wait `retryAfterSeconds`.                                                        |
| 500    | `INTERNAL`                                                                     | Something broke. The message is generic; Olympics logs the detail.                               |
| 503    | `NOT_CONFIGURED`, `UNAVAILABLE`                                                | An integration (Google Calendar) is not set up or failed just now.                               |

**Idempotency.** Repeating a write with the same `Idempotency-Key` and the
same input returns the stored answer without running it again (the ledger is
keyed per member the action runs as, source and key). A write that failed may be retried with
the same key.

**Rate limits.** 300 calls a minute per token; each action's own limits per
Telegram user (30 writes or 120 reads a minute by default); and
`link_telegram` 5 tries per Telegram user and 30 per token in 10 minutes.

## Linking a Telegram account (`/link`)

1. The member opens **Settings** in Olympics and taps **Create a link code**.
   The code (10 characters, valid 10 minutes, single use) is shown once;
   only its hash is stored.
2. They send `/link <code>` to the Baumy bot.
3. Brain calls `POST /api/v1/actions/link_telegram` with `{"code": "<code>"}`,
   the sender in `X-Baumy-Actor` and a fresh `Idempotency-Key`. This is the
   ONE action an unlinked Telegram user may call; the member comes from the
   code, not from the header.
4. Olympics claims the code with one `UPDATE … RETURNING` (unused and
   unexpired), sets `members.telegram_user_id` and audits it with
   `source=brain`. The answer is `{memberId, displayName}`, so brain can say
   "Linked you as Ryan".

It refuses, with 422:

- `LINK_CODE_INVALID`: wrong, already used, expired, or made by a member who
  has since been deactivated;
- `TELEGRAM_ALREADY_LINKED`: that Telegram account is linked to another
  member (an admin can clear it on `/admin/members`). The code stays unused.

Linking a member who was linked to another Telegram account moves the link.
An admin can also set or clear anyone's Telegram user id directly on
`/admin/members` (`manage_members`, op `set_telegram`).

## Sign in with Baumy (`approve_login`, `deny_login`)

Issue #80, ADR 0006. Someone taps **Sign in with Baumy** on the sign-in page
(the kitchen iPad, say) and enters their email. The page shows a two-digit
number, and Olympics asks brain to DM that member:

```http
POST https://brain.baumy.tech/api/kitchen/login-approval
Authorization: Bearer $KITCHEN_API_TOKEN
Content-Type: application/json

{"requestId": "<uuid>", "telegramUserId": 123456789, "device": "Safari on iPad",
 "choices": [12, 30, 47, 65, 83], "expiresAt": "2026-09-28T10:02:00.000Z"}
```

Brain answers `{ok: true, sent: true}`, or `{ok: true, sent: false}` when
that Telegram id is not an active member of the house (nothing is sent). It
DMs only that member, never the group: "Sign in on Safari on iPad? Tap the
number on the screen." with one button per number, in the order given, and
**Deny**. The call is made after the sign-in page got its answer, so whether
it happens never shows on the page.

A tap calls, as the member who tapped (`X-Baumy-Actor: tg:<from.id>`, never
on anyone's behalf):

- a number: `approve_login {"requestId": "<uuid>", "code": 47}` with
  `X-Baumy-Confirmed: 1` (the tap is the confirmation) and a fresh
  `Idempotency-Key` per tap. `data.outcome` is `approved` (the page signs
  in) or `blocked` (a decoy: the request is denied);
- **Deny**: `deny_login {"requestId": "<uuid>"}`; `data.outcome` is
  `denied`.

After any denial, Sign in with Baumy is off for that member for 15 minutes
(Olympics simply sends no DM), against push fatigue.

Then edit the DM, dropping the buttons. `NOT_FOUND` (not this member's
request) and `INVALID_STATE` (expired, or already answered) carry a
`message` to show. These two actions come only from those buttons: never
from a conversation, and never offered to brain's LLM.

## Service tokens

Only the sha256 of a token is stored (`service_tokens`); the plaintext lives
in brain's env and never in Olympics'.

An admin manages them on **`/admin/connections`** (issue #104; Admin →
Connections): **Create token**, **Rotate** and **Revoke**, with the name,
scopes, created, last used and revoked dates of every token. The new token
is shown once, with a Copy button and "put it in brain's Vercel project as
`BRAIN_SERVICE_TOKEN`". These are the registry actions
`create_service_token`, `rotate_service_token` and `revoke_service_token`
(`apps/web/lib/actions/service-tokens.ts`): admin only, UI only, audited,
each refused on a session signed out elsewhere. Creating and rotating also
need the admin's password or a sign-in under 10 minutes old; the result
keeps the token out of the request ledger (`storedData`) and the audit row
names only the token. Tokens minted there always get the `brain` scope.
`last_used_at` is written by the endpoint at most every 5 minutes.

The CLI does the same from a terminal. It prints the token once, alone on
stdout, and needs `DATABASE_URL_UNPOOLED` (the direct Neon string for
production):

```sh
pnpm --filter @baumy/db --silent service-token mint baumy-brain    # print a new token
pnpm --filter @baumy/db --silent service-token rotate baumy-brain  # revoke and mint in one go
pnpm --filter @baumy/db --silent service-token revoke baumy-brain  # 401 from the next request
pnpm --filter @baumy/db --silent service-token list                # names and dates, never tokens
```

A token gets the `brain` scope unless `--scopes` says otherwise. There is one
live token per name.

## Example

```sh
curl -sS https://<olympics>/api/v1/actions/create_event \
  -H "Authorization: Bearer $BRAIN_SERVICE_TOKEN" \
  -H "X-Baumy-Actor: tg:123456789" \
  -H "X-Baumy-Confirmed: 1" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"title":"Dinner","kind":"timed","date":"2026-10-02","startTime":"19:00","endTime":"20:30"}'
```
