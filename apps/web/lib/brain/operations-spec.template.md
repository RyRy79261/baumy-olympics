# Baumy Olympics: operations spec for Baumy (baumy-brain)

<!-- GENERATED FILE. Do not edit docs/brain-operations-spec.md by hand. Edit apps/web/lib/brain/operations-spec.template.md (the prose) or apps/web/lib/brain/operations-spec-notes.ts (the per-action notes), then run `pnpm brain:spec`. A unit test fails while the doc is out of date with the action registry. -->

This is everything the Telegram bot Baumy (baumy-brain, `@baumy_bot`) needs to
run the household's Olympics for its members: what the household is, how to
call Olympics, and every action it may call. The action list, input schemas,
risks, gates and limits below are generated from Olympics' action registry, so
they are exactly what the endpoint enforces. The short contract is
`docs/brain-integration.md` in baumy-olympics; this doc is the long form.

**Owner rulings (2026-09-28, baumy-olympics issue #70).**

1. Baumy gets **every member action**, the destructive ones included
   (`delete_event`, `delete_note`). A `confirm` or `destructive` action always
   waits for the asker's inline confirm button; a read, or a `safe` write for
   the asker, does not (section 3). Admin actions stay in the Olympics app only
   (SPEC §12 decision 10), except adding and editing a bounty and recording
   money in the pot (amended 2026-09-29, issue #107): those only for a linked
   admin, in their own name, behind the confirm button.
2. **Baumy can act on behalf of housemates.** With `X-Baumy-On-Behalf-Of` the
   action runs as that housemate; the audit trail records both the housemate
   and the linked member who asked. Any write on someone's behalf needs the
   asker's confirm tap, even a `safe` one.

## 1. Calling Olympics

| Method | Path                     | What it does                                                                                 |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/actions`        | `{ok: true, actions: [{name, title, description, input_schema, kind, risk, member_field?}]}` |
| `POST` | `/api/v1/actions/{name}` | Runs one action. The JSON body is its input; an empty body is `{}`.                          |

### Headers

| Header                              | When          | Meaning                                                                                                                       |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <token>`     | always        | `BRAIN_SERVICE_TOKEN`. Olympics stores only its sha256. Missing, unknown or revoked: 401.                                     |
| `X-Baumy-Actor: tg:<telegram id>`   | every `POST`  | The authenticated sender (`from.id`), never text. Mapped to an active member on every call except `link_telegram`.            |
| `X-Baumy-On-Behalf-Of: <member id>` | optional      | Run the action as this housemate (section 4).                                                                                 |
| `X-Baumy-Confirmed: 1`              | see section 3 | Send it only from the confirm-tap handler, after the asker tapped. Any other value counts as not confirmed.                   |
| `Idempotency-Key: <key>`            | every write   | 8 to 128 of `A-Z a-z 0-9 . _ : -`, minted once per intended action (when the card is proposed). A retry resends the same key. |

The endpoint checks, in this order: the token and its `brain` scope, 300
calls a minute per token, that the action is offered to Baumy, the actor
header and its link, the on-behalf header, the confirm header, and the
idempotency key. Then the action runs exactly as it would in the app, with
`source=brain`.

### Answers

A success is `200 {ok: true, data}`. A failure is `{ok: false, code, message}`
plus `issues` (with `INVALID_INPUT`), `retryAt` (with `COOLDOWN`) or
`retryAfterSeconds` (with `RATE_LIMITED`, also sent as `Retry-After`).
`message` is a sentence written to be shown to the person as it is.

| Status | `code`                          | What Baumy does                                                                                               |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_INPUT`                 | A bug on our side or a bad slot: `issues` says which field or header. Ask the person to rephrase.             |
| 401    | `UNAUTHENTICATED`               | Olympics is not (correctly) connected. "Baumy Olympics isn't connected to me yet."                            |
| 403    | `FORBIDDEN`                     | Not allowed for this member (for example confirming your own claim). Show `message`.                          |
| 403    | `SURFACE_FORBIDDEN`             | Not Baumy's to do (admin or app-only). "That's done in the Olympics app."                                     |
| 403    | `TELEGRAM_NOT_LINKED`           | "Link your Telegram first: Olympics → Settings → Link Telegram, then tap Start here (or DM me /link <code>)." |
| 404    | `UNKNOWN_ACTION`, `NOT_FOUND`   | No such action, or the thing (event, note, reminder, claim, housemate) is gone. Show `message`.               |
| 409    | `IDEMPOTENCY_CONFLICT`          | The key was used for a different call: our bug. Mint a new key and propose again.                             |
| 409    | `IN_PROGRESS`                   | The same key is still running. Retry with the same key in a moment.                                           |
| 422    | domain codes (`COOLDOWN`, …)    | The action understood and said no. Show `message`; each action below lists its own.                           |
| 428    | `CONFIRMATION_REQUIRED`         | The call needed the confirm tap. Show the card; never retry without a tap.                                    |
| 429    | `RATE_LIMITED`                  | Wait `retryAfterSeconds`.                                                                                     |
| 500    | `INTERNAL`                      | Something broke on Olympics' side. Retry with the same key, then say it is not answering.                     |
| 503    | `NOT_CONFIGURED`, `UNAVAILABLE` | Google Calendar (or brain itself) is not set up or did not answer. Say so; retry later with the same key.     |

### Idempotency

Repeating a write with the same `Idempotency-Key` and the same input returns
the stored answer without running it again. The ledger is keyed on the member
the action runs as, the source and the key. A failed write may be retried with
the same key. A different input under a used key is `IDEMPOTENCY_CONFLICT`.

### Time

The household lives in **Europe/Berlin**. Days (`date`, `from`, `to`) are
Berlin `YYYY-MM-DD`; event times are Berlin wall-clock `HH:MM` (24h). Instants
in answers (`occurredAt`, `retryAt`, `createdAt`, …) are ISO 8601 in UTC:
convert them to Berlin time before showing them. An instant sent to Olympics
(`occurredAt`) must carry its offset. Seasons are Berlin calendar years.

## 2. Linking Telegram (`/link`)

1. The member opens **Settings** in Olympics and taps **Link Telegram**
   (a code of 10 characters, valid 10 minutes, single use).
2. Settings shows it as the deep link `https://t.me/baumy_bot?start=link_<code>`
   (a button and a QR code). Tapping **Start** sends Baumy `/start link_<code>`
   in the member's DM: treat it exactly like `/link <code>`. The fallback is
   DMing `/link <code>`. Refuse `/link` in the group: whoever reads a code first
   could claim it.
3. Baumy calls `link_telegram` `{"code": "<code>"}` with the sender in
   `X-Baumy-Actor` and an `Idempotency-Key` fixed for that message (a retry
   replays the answer instead of spending the code twice). This is the only
   action an unlinked sender may call.
4. The answer is `{memberId, displayName}`: "Linked you as <displayName>."

`LINK_CODE_INVALID` (wrong, used, expired, or its member left) and
`TELEGRAM_ALREADY_LINKED` (another member has this Telegram account; an admin
can clear it) are 422 with a `message` to show.

## 3. Confirmations

Baumy's rule stays: the language model proposes, deterministic code calls
Olympics. Which calls need the asker's tap on an inline confirm button, sent
with `X-Baumy-Confirmed: 1`:

| Call                                      | Tap needed | Why                                                                               |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| a read (`kind: read`)                     | never      | Nothing changes, for the asker or on anyone's behalf.                             |
| a `safe` write for the asker              | no         | Low stakes and reversible (a note, a reminder, "seen").                           |
| a `confirm` write                         | always     | It changes the score or the shared calendar.                                      |
| a `destructive` write                     | always     | It removes something for everyone. Name the exact thing (title, day) on the card. |
| **any** write with `X-Baumy-On-Behalf-Of` | always     | It speaks for someone else.                                                       |

Without the header Olympics answers 428 `CONFIRMATION_REQUIRED` and nothing
runs. Only the asker's tap resolves the card (the call runs as them, or with
them as the initiator). The tap sends the key minted when the card was
proposed, so a retried tap, or a card reopened after Olympics did not answer,
runs at most once.

## 4. Acting on a housemate's behalf

"Mark the plumber reminder seen for Sam", "Jo says she's seen it", "what's
waiting on Sam?": send `X-Baumy-On-Behalf-Of: <Sam's member id>`.

- The target must be an **active member of this household**; anyone else is
  404 `NOT_FOUND` ("That person is not an active member of the household.").
  A malformed id is 400.
- The action runs **as the housemate**: their permissions, their idempotency
  ledger, their answer (`whoami` answers as them). The audit row has the
  housemate as the actor, and the asker as `initiated_by_member_id`, with
  `source=brain`.
- Any **write** on someone's behalf needs the asker's tap (section 3). Reads
  do not.
- The asker's own id in the header is the same as no header, for every
  action: the refusals below are only for acting for someone else.
- Not for `link_telegram`, and not for an action that names its member in its
  own input (`member_field` in the tool list): those answer 400. Today that is
  `log_completion`: "Jo did the dishes" is `log_completion` with
  `doneBy: <Jo's id>`. The asker logs it and **vouches** for Jo, so it counts
  at once, and the record says truthfully who logged it. On-behalf would
  claim Jo logged it herself.
- **Never for someone's own word** (403 `FORBIDDEN`, before any confirm
  card): the claim events `confirm_completion`, `dispute_completion`,
  `undo_completion`, `withdraw_dispute` and `concede_completion`
  (`own_word_only` in the tool list). The member has to say it themself, or
  the honesty layer (nobody confirms their own claim) would mean nothing.
  Tell the asker the housemate has to do it. Notes, reminders, calendar
  events and the rest do work on a housemate's behalf.
- Admin actions stay unavailable, on anyone's behalf. The three admin writes
  brain gets (`create_bounty`, `update_bounty`, `add_pot_contribution`) run
  only for a linked admin in their own name (`admin_only` in the tool list):
  a member gets 403 `FORBIDDEN`, and `X-Baumy-On-Behalf-Of` is refused with
  403 "Admin changes can't be made on someone's behalf."
- To turn a name into a member id, read the roster: `list_reminders` answers
  `members` (id, name) for every active member; `get_standings` lists them
  with their points. Match the name to exactly one member, or ask.

## 5. The household, as Olympics models it

- **Members.** Each housemate is a member with a display name, a colour and a
  gallery character, if picked. One or more are admins; admin work happens in the app,
  except adding or editing a bounty and recording pot money, which an admin
  may ask Baumy for.
  Nobody is hard-coded: always read names from Olympics.
- **Bounties are chores.** Each chore has a `kind`: `consumable` (buy or
  refill: toilet paper, dish soap) or `maintenance` (clean or fix: trash,
  bathroom). It has base points and a cooldown. `urgent` means overdue on
  its own rhythm: its last completion plus its interval has passed, or falls
  before midnight in Berlin. A chore never done is never urgent, only
  available (and new, if recent). `isNew` means added in the last 3 days. Logging a chore inside its cooldown is refused (`COOLDOWN`, with
  `retryAt`).
- **Streaks and break bonuses.** Each chore has one streak holder. Doing a
  chore again while you hold it grows the streak (+25% of base per step, no
  cap). Doing a chore someone else holds **breaks** their streak: you get a
  break bonus (20% of base per broken step, capped at 10 steps) and start your
  own at 1. Nobody loses points; scores only go up. Streaks reset on 1 January
  (a season is a Berlin calendar year).
- **Points and the pot.** Season points are scored completions plus approved
  adjustments. The pot is a savings ledger in euro cents; the leader at the
  end of the season takes it all (money moves at the bank, not in Olympics).
- **Confirmations and the 24-hour dispute window.** Logging for someone else
  verifies the claim at once. A self-claim is `pending`: it counts
  provisionally and finalizes 24 hours after logging, unless someone confirms
  it sooner or disputes it inside those 24 hours (a dispute needs a reason). A
  disputed claim scores nothing; it is voided when the window ends unless the
  doer attached a photo in time. The disputer can withdraw, the doer can
  concede, and the logger can undo within 10 minutes. Some chores are in
  partner mode: a self-claim counts only once someone confirms it (72 hours,
  then it is voided).
- **Weights.** Every week Olympics suggests new points for chores from how
  often they are really done. An admin schedules a change; any other member
  may veto it before it applies (next Monday, 00:00 Berlin, at least 48 hours
  ahead).
- **Reminders** are full-screen messages on the kitchen screen, for things
  everyone must read. Each shows every member's character with a Seen button.
  It stays until every member who had joined when it was posted has seen it,
  or someone dismisses it. These are not Baumy's own timed Telegram
  reminders; those stay in Baumy.
- **Notes** are the household message board: a title, a short markdown body,
  a colour, and pinned ones on the kitchen screen. Never put a secret in a
  note; Baumy keeps secrets encrypted itself.
- **Calendar.** The house Google Calendar. Events are timed or all day, in
  Berlin days and times. Private events are never shown.
- **Shopping** is Baumy's own list (`baumy_list_items`). Olympics shows it on
  the kitchen screen by calling Baumy's kitchen API; Baumy never needs to call
  Olympics to change it.

## 6. Actions at a glance

<!-- generated:summary -->

## 7. The actions

<!-- generated:actions -->

## 8. Not available to Baumy

<!-- generated:unavailable -->
