import type { ActionName } from "@/lib/actions/define";
import type { ActionErrorCode } from "@/lib/actions/result";

// The hand-written half of docs/brain-operations-spec.md (issue #70): what
// each brain action is for, when Baumy should reach for it, what people say,
// and what Baumy must say back. The other half (names, schemas, risk, gates,
// limits) is read from the registry by operations-spec.ts, so a new brain
// action without notes here fails the spec's freshness test.

export interface BrainActionNotes {
  /** One sentence: what it does, in the household's words. */
  purpose: string;
  /** When Baumy should use it, and when it should not. */
  when: string;
  /** What people say, and the call that answers it. */
  examples: { say: string; call: string }[];
  /** The useful part of `data`, in words. */
  returns: string;
  /** The action's own refusals (the endpoint's codes apply to every call). */
  errors: ActionErrorCode[];
  /** What Baumy tells the person after the call. */
  reply: string;
  /** Required when the action's gate depends on its input. */
  gate?: string;
}

/**
 * Member actions (not admin, not account self-service) that brain does NOT
 * get, each with the reason. registry.test.ts holds every other member
 * action to `surfaces ∋ "brain"`.
 */
export const BRAIN_EXCLUDED: Partial<Record<ActionName, string>> = {
  attach_completion_photo:
    "A proof photo arrives only through the app's upload route, which stores the file first; brain cannot send one. Tell the person to attach it in the app.",
  add_shopping_items:
    "The shopping list is brain's own (`baumy_list_items`); brain changes it directly, and Olympics calls brain to do the same.",
  check_off_shopping_items:
    "The shopping list is brain's own; brain ticks items off directly.",
  check_kiosk_pin:
    "Checks a PIN typed on the kitchen screen; only the kiosk has one.",
};

const CLAIM_ERRORS: ActionErrorCode[] = [
  "NOT_FOUND",
  "INVALID_STATE",
  "WINDOW_CLOSED",
  "FORBIDDEN",
];

const CALENDAR_ERRORS: ActionErrorCode[] = ["NOT_CONFIGURED", "UNAVAILABLE"];

export const BRAIN_ACTION_NOTES: Record<string, BrainActionNotes> = {
  whoami: {
    purpose: "Says which household member Baumy is acting as.",
    when: "Before a write, to check the sender is linked (an unlinked sender gets TELEGRAM_NOT_LINKED here, before any confirm card), and to learn their member id and name.",
    examples: [{ say: "who am I in the Olympics?", call: "whoami {}" }],
    returns:
      "`memberId`, `displayName`, `role` (admin or member), `color`, `avatarSprite` and `actorKind` (always `service` for brain).",
    errors: ["NOT_FOUND"],
    reply:
      'Nothing, unless asked. If asked: "You\'re linked as <displayName>."',
  },
  link_telegram: {
    purpose:
      "Links the sender's Telegram account to the member who created the code in Olympics' Settings.",
    when: "Only for `/link <code>` sent in a DM. Refuse it in the group: anyone who reads a code there could claim it first.",
    examples: [
      {
        say: "/link K7PQ2MX9RT",
        call: 'link_telegram {"code": "K7PQ2MX9RT"}',
      },
    ],
    returns:
      "`memberId` and `displayName` of the member the account is now linked to.",
    errors: ["LINK_CODE_INVALID", "TELEGRAM_ALREADY_LINKED"],
    reply:
      '"Linked you as <displayName>." On LINK_CODE_INVALID: "That code didn\'t work. Make a new one in Olympics → Settings (it lasts 10 minutes)." On TELEGRAM_ALREADY_LINKED: show `message`.',
  },
  approve_login: {
    purpose:
      "Approves a 'Sign in with Baumy' request with the number the member tapped in the approval DM.",
    when: "ONLY from the number buttons of the approval DM (`POST /api/kitchen/login-approval` asked for it), as the member who tapped. Never from a conversation, never from the LLM, never on anyone's behalf: the number proves the person holding the phone is looking at the sign-in screen. Send the tapped number as it is; Olympics decides whether it is the right one.",
    examples: [
      {
        say: "(taps 47 on the approval DM)",
        call: 'approve_login {"requestId": "<from the DM request>", "code": 47}',
      },
    ],
    returns:
      "`outcome`: `approved` (the browser signs in now) or `blocked` (that was not the number on the screen, so the sign-in was refused and Sign in with Baumy is off for this member for 15 minutes); `device`, e.g. `Chrome on macOS`.",
    errors: ["NOT_FOUND", "INVALID_STATE"],
    reply:
      'Edit the DM, dropping the buttons. approved: "✅ Signed in on <device>." blocked: "🚫 That wasn\'t the number on the screen, so I blocked this sign-in. If it wasn\'t you, nothing happened; sign in with your password if it was." NOT_FOUND or INVALID_STATE: show `message`.',
  },
  deny_login: {
    purpose: "Denies a 'Sign in with Baumy' request: the member tapped Deny.",
    when: "ONLY from the Deny button of the approval DM, as the member who tapped. Never from a conversation.",
    examples: [
      {
        say: "(taps Deny on the approval DM)",
        call: 'deny_login {"requestId": "<from the DM request>"}',
      },
    ],
    returns:
      "`outcome`: `denied` (Sign in with Baumy is then off for this member for 15 minutes); `device`.",
    errors: ["NOT_FOUND", "INVALID_STATE"],
    reply:
      'Edit the DM, dropping the buttons: "✖️ Denied the sign-in on <device>." NOT_FOUND or INVALID_STATE: show `message`.',
  },
  list_chores: {
    purpose:
      "Lists the bounties (chores): what is due, urgent or new, and what each would score now.",
    when: 'To answer "what needs doing?", and to turn a chore someone names into its `choreId` before log_completion. Match the words to exactly one chore; if none or several match, list them and ask.',
    examples: [
      { say: "what needs doing?", call: "list_chores {}" },
      { say: "what's urgent?", call: "list_chores {} (keep `urgent: true`)" },
    ],
    returns:
      "`chores`: each one's `id`, `name`, `kind` (consumable or maintenance), `basePoints`, `cooldownMinutes`, `state` (due, cooling down with `availableAt`, or done for now), `urgent`, `isNew`, `streak` (holder and length) and `next` (what logging it now would score the asker).",
    errors: [],
    reply:
      'Urgent ones first, then due, then the rest; say points as "+N". Times in Berlin time.',
  },
  log_completion: {
    purpose: "Logs that someone did a chore, and scores it.",
    when: 'When someone says they (or a named housemate) did a chore. For "Jo did the dishes", send `doneBy: <Jo\'s id>`: the asker logs it and vouches for Jo, so it counts at once. Never use X-Baumy-On-Behalf-Of for this (it is refused with 400): that would claim Jo logged it herself.',
    gate: "any linked member; logging for someone else (`doneBy`) vouches for them, which brain may do as the asker (on the kiosk it would need a PIN).",
    examples: [
      {
        say: "I took the trash out",
        call: 'log_completion {"choreId": "<Trash, from list_chores>"}',
      },
      {
        say: "Jo did the dishes last night at 11",
        call: 'log_completion {"choreId": "<Dishes>", "doneBy": "<Jo\'s member id>", "occurredAt": "2026-09-27T23:00:00+02:00"}',
      },
    ],
    returns:
      "`completionId`, `choreName`, `doneBy`/`doneByName`, `status`, `counted` (false while a partner-mode claim waits for someone to confirm), `totalPts`, `streakLen`, and a break (`breakPts`, `brokenMemberName`, `brokenLen`) if one happened.",
    errors: [
      "COOLDOWN",
      "FUTURE",
      "BACKDATE_TOO_FAR",
      "OUT_OF_ORDER",
      "SEASON_CLOSED",
      "PHOTO_REQUIRED",
      "ARCHIVED_CHORE",
      "NO_RULE_VERSION",
      "NOT_FOUND",
    ],
    reply:
      '"Logged <choreName> for <doneByName>: +<totalPts> (streak <streakLen>)", plus "and broke <brokenMemberName>\'s streak of <brokenLen> for +<breakPts>" when there was a break, or "it counts once someone confirms it" when `counted` is false. On COOLDOWN say when it can be logged again (`retryAt`, in Berlin time). On PHOTO_REQUIRED: "that one needs a photo, log it in the app".',
  },
  get_pending_confirmations: {
    purpose:
      "Lists chore claims still waiting to settle, and what the asker may do to each.",
    when: 'For "anything waiting on me?", and to find the `completionId` before confirming, disputing, undoing, withdrawing or conceding. Use `can` to offer only what is allowed.',
    examples: [
      {
        say: "anything I need to confirm?",
        call: "get_pending_confirmations {}",
      },
    ],
    returns:
      "`claims` (pending or disputed; who did and logged each, when its window ends, any dispute and reason, `can`, `needsYou`) and `recent` (the asker's own claims settled in the last 7 days).",
    errors: [],
    reply:
      'The ones with `needsYou` first, each as "<doer> did <chore> <when>" with the actions `can` allows.',
  },
  confirm_completion: {
    purpose: "Confirms a housemate's self-claimed chore, which verifies it.",
    when: 'When someone says a housemate really did it ("yes, Sam did clean the bathroom"). Not for your own claims, and never on behalf of someone else (403): if Jo says Sam did it, Jo confirms it herself.',
    examples: [
      {
        say: "yes Sam did the bathroom",
        call: 'confirm_completion {"completionId": "<from get_pending_confirmations>"}',
      },
    ],
    returns: "`completionId`, `choreName`, the new `status` and `finalizesAt`.",
    errors: CLAIM_ERRORS,
    reply: '"Confirmed <doer>\'s <choreName>."',
  },
  dispute_completion: {
    purpose:
      "Disputes a housemate's self-claimed chore inside its 24-hour window, with a reason.",
    when: "When someone says a claimed chore was not done. Ask for the reason if none was given; it is required.",
    examples: [
      {
        say: "Sam didn't do the bathroom, it's still dirty",
        call: 'dispute_completion {"completionId": "<id>", "reason": "Still dirty"}',
      },
    ],
    returns: "`completionId`, `choreName`, the new `status` (disputed).",
    errors: [...CLAIM_ERRORS, "REASON_REQUIRED"],
    reply:
      '"Disputed <doer>\'s <choreName>. It scores nothing unless they attach a photo in time or you withdraw it."',
  },
  undo_completion: {
    purpose:
      "Undoes a chore the asker logged, within 10 minutes of logging it.",
    when: 'For "oops, undo that" right after a log. After 10 minutes it is WINDOW_CLOSED; say so.',
    examples: [
      {
        say: "undo that, wrong chore",
        call: 'undo_completion {"completionId": "<the one just logged>"}',
      },
    ],
    returns: "`completionId`, `choreName`, `status` (voided).",
    errors: CLAIM_ERRORS,
    reply: '"Undone: <choreName> no longer counts."',
  },
  withdraw_dispute: {
    purpose: "Withdraws a dispute the asker raised; the claim counts again.",
    when: 'When the disputer says they were wrong ("ok Sam did do it").',
    examples: [
      {
        say: "I take back my dispute on the bathroom",
        call: 'withdraw_dispute {"completionId": "<id>"}',
      },
    ],
    returns: "`completionId`, `choreName`, `status` (pending), `finalizesAt`.",
    errors: CLAIM_ERRORS,
    reply: '"Withdrawn. <choreName> counts again."',
  },
  concede_completion: {
    purpose: "Concedes a dispute on the asker's own claim; it is voided.",
    when: 'When the doer agrees they did not do it ("fair, I didn\'t finish it").',
    examples: [
      {
        say: "fine, I'll concede the bathroom",
        call: 'concede_completion {"completionId": "<id>"}',
      },
    ],
    returns: "`completionId`, `choreName`, `status` (voided).",
    errors: CLAIM_ERRORS,
    reply: '"Conceded. <choreName> is off your score."',
  },
  get_standings: {
    purpose: "The season scoreboard.",
    when: 'For "who\'s winning?", points, gaps and the recent scores.',
    examples: [
      { say: "who's winning?", call: "get_standings {}" },
      { say: "how did last year end?", call: 'get_standings {"year": 2025}' },
    ],
    returns:
      "`standings` (rank, member, points, provisional points, gap to the leader), `leaderId` (null on a tie), the season and its prize mode, `recent` scored completions with their breakdown, and `adjustments`.",
    errors: ["PRIZE_MODE_NOT_SUPPORTED"],
    reply:
      'The top of the table as "1. Ryan 240 (+30 provisional)", and the leader, or that it is a tie.',
  },
  get_streaks: {
    purpose: "Who holds each chore's streak, and the season's best runs.",
    when: 'For "who has the trash streak?" or "longest streak this year?".',
    examples: [{ say: "who's on a streak?", call: "get_streaks {}" }],
    returns:
      "`current` (each chore's holder and length) and `best` (the season's best runs: chore, member, length, weight, dates).",
    errors: [],
    reply: '"<member> holds <chore> ×<length>."',
  },
  get_pot: {
    purpose: "The season's savings pot (a ledger; money moves at the bank).",
    when: 'For "how much is in the pot?" and who would take it.',
    examples: [{ say: "how big is the pot?", call: "get_pot {}" }],
    returns:
      "`months` (each month's contributions in euro cents and the running total), `totalCents` and `leader`.",
    errors: ["PRIZE_MODE_NOT_SUPPORTED"],
    reply:
      'Amounts in euros ("€120.00"), and who would take it now, or that nobody leads outright.',
  },
  add_pot_contribution: {
    purpose:
      "Records money paid into the season's pot (a ledger; the money moves at the bank).",
    when: "Only when an admin says they (or a named housemate) paid into the pot. A non-admin gets FORBIDDEN: say an admin records it. Leave `month` out for this month; set `contributedBy` to a member id when someone else paid.",
    examples: [
      {
        say: "put €20 in the pot",
        call: 'add_pot_contribution {"amount": "20"}',
      },
      {
        say: "Anna paid 25 for August",
        call: 'add_pot_contribution {"amount": "25", "month": "2026-08", "contributedBy": "<Anna\'s member id>"}',
      },
    ],
    returns: "`contributionId`, `month`, `amountCents`, `contributedBy`.",
    errors: ["NOT_FOUND", "FUTURE", "SEASON_CLOSED"],
    reply: '"Added €<amount> to the pot for <month>."',
  },
  get_weights: {
    purpose:
      "Each chore's points and cooldown, how often it is really done, and the weight changes scheduled for next Monday.",
    when: 'For "why is the trash worth so little?" or "any weight changes coming?" (`scheduledOnly: true`), and to find a `suggestionId` to veto.',
    examples: [
      {
        say: "any point changes coming?",
        call: 'get_weights {"scheduledOnly": true}',
      },
    ],
    returns:
      "`chores` (current points and cooldown, the measured median gap, the suggestion) and `scheduled` (changes about to apply, with `appliesAt` and `canVeto`).",
    errors: [],
    reply:
      '"<chore> goes from <old> to <new> points on <Berlin date>, unless someone vetoes it."',
  },
  veto_weight: {
    purpose:
      "Vetoes a scheduled weight change before it applies. Only a member other than the one who scheduled it may.",
    when: "When someone objects to a scheduled change. Use `canVeto` from get_weights first; the scheduler cannot veto their own change.",
    examples: [
      {
        say: "veto the trash points change",
        call: 'veto_weight {"suggestionId": "<from get_weights scheduled>"}',
      },
    ],
    returns: "`suggestionId`, `choreId`, `status` (vetoed).",
    errors: ["NOT_FOUND", "INVALID_STATE", "WINDOW_CLOSED", "SELF_VETO"],
    reply: '"Vetoed. <chore> keeps its points."',
  },
  create_bounty: {
    purpose:
      "Adds a bounty (a chore that scores points) to the board, as an admin.",
    when: "Only when an admin asks for a new bounty. A non-admin gets FORBIDDEN: say an admin adds it. Give a name and points; the rest has defaults (maintenance, 24 h cooldown, no photo, counts at once).",
    examples: [
      {
        say: "add a bounty for recycling paper, 15 points",
        call: 'create_bounty {"name": "Recycling (paper)", "points": 15}',
      },
      {
        say: "new bounty: buy dish soap, 10 points",
        call: 'create_bounty {"name": "Dish soap", "kind": "consumable", "points": 10}',
      },
    ],
    returns: "`choreId` and `name` of the new bounty.",
    errors: ["CHORE_NAME_TAKEN"],
    reply: '"Added the <name> bounty: <points> points."',
  },
  update_bounty: {
    purpose:
      "Edits a bounty as an admin: only the fields sent change. A new weight counts from now.",
    when: "Only when an admin asks to change a bounty's name, kind, points, cooldown, photo or confirm rule. Find the `choreId` with list_chores. Archiving is done in the app.",
    examples: [
      {
        say: "make the trash worth 30 points",
        call: 'update_bounty {"choreId": "<from list_chores>", "points": 30}',
      },
    ],
    returns: "`choreId`, `name` and `weightChanged`.",
    errors: ["NOT_FOUND", "ARCHIVED_CHORE", "CHORE_NAME_TAKEN"],
    reply: '"Done: <name> is now <what changed>."',
  },
  list_events: {
    purpose: "The house calendar between two Berlin days.",
    when: 'For "what\'s on this weekend?", and to find an `eventId` before changing or deleting an event.',
    examples: [
      {
        say: "what's on this weekend?",
        call: 'list_events {"from": "2026-10-03", "to": "2026-10-04"}',
      },
    ],
    returns:
      "`events`: id, title, notes, place, all day or not, first and last day, Berlin start and end (HH:MM), who added it.",
    errors: ["INVALID_INPUT", ...CALENDAR_ERRORS],
    reply:
      'One line per event: "Sat 3 Oct 19:00–20:00 Dinner with Anna". Nothing on: say so.',
  },
  create_event: {
    purpose: "Adds an event to the house Google Calendar.",
    when: "When someone asks to add something to the calendar. Resolve the day and time to Berlin `YYYY-MM-DD` and `HH:MM` first; no time means `all_day`.",
    examples: [
      {
        say: "add dinner with Anna Saturday 19:00",
        call: 'create_event {"title": "Dinner with Anna", "kind": "timed", "date": "2026-10-03", "startTime": "19:00", "endTime": "20:00"}',
      },
      {
        say: "Mum visits 10 to 12 October",
        call: 'create_event {"title": "Mum visits", "kind": "all_day", "date": "2026-10-10", "endDate": "2026-10-12"}',
      },
    ],
    returns: "`event`: the event as stored, with its `id`.",
    errors: CALENDAR_ERRORS,
    reply: '"Added <title> on <day> <time>."',
  },
  update_event: {
    purpose: "Changes a calendar event; every field is replaced.",
    when: "When someone moves or renames an event. Read it with list_events and send ALL its fields, changed and unchanged.",
    examples: [
      {
        say: "move dinner with Anna to 20:00",
        call: 'update_event {"eventId": "<id>", "title": "Dinner with Anna", "kind": "timed", "date": "2026-10-03", "startTime": "20:00", "endTime": "21:00"}',
      },
    ],
    returns: "`event`: the event as it is now.",
    errors: ["NOT_FOUND", ...CALENDAR_ERRORS],
    reply: '"Moved <title> to <day> <time>."',
  },
  delete_event: {
    purpose: "Deletes an event from the house calendar.",
    when: "Only when someone clearly asks to remove an event. Name the exact event (title and day) on the confirm card.",
    examples: [
      {
        say: "cancel dinner with Anna on Saturday",
        call: 'delete_event {"eventId": "<id from list_events>"}',
      },
    ],
    returns: "`eventId` and `title` of the deleted event.",
    errors: ["NOT_FOUND", ...CALENDAR_ERRORS],
    reply: '"Deleted <title>."',
  },
  list_notes: {
    purpose: "The household message board.",
    when: 'For "what\'s on the board?", and to find a `noteId` before changing, pinning or deleting a note.',
    examples: [
      {
        say: "what's pinned on the board?",
        call: 'list_notes {"pinnedOnly": true}',
      },
    ],
    returns:
      "`notes`: id, title, markdown body, colour, pinned, author, created and changed times.",
    errors: [],
    reply: "Titles first, pinned ones marked; the body only when asked.",
  },
  create_note: {
    purpose: "Posts a note on the household message board.",
    when: 'For "put a note up: …". Never put a secret (door code, wifi password, bank details) in a note; brain keeps those encrypted itself. For something everyone must see now, create_reminder is better.',
    examples: [
      {
        say: "put a note up: recycling goes out on Tuesdays",
        call: 'create_note {"title": "Recycling", "bodyMd": "Goes out on **Tuesdays**."}',
      },
    ],
    returns: "`note`: the note as stored, with its `id`.",
    errors: [],
    reply: '"Posted <title> on the board."',
  },
  update_note: {
    purpose: "Rewrites a note: title, body and colour are all replaced.",
    when: "When someone changes a note. Read it first and send the whole note; a body or colour left out is emptied.",
    examples: [
      {
        say: "change the recycling note to Wednesdays",
        call: 'update_note {"noteId": "<id>", "title": "Recycling", "bodyMd": "Goes out on **Wednesdays**."}',
      },
    ],
    returns: "`note`: the note as it is now.",
    errors: ["NOT_FOUND"],
    reply: '"Updated <title>."',
  },
  pin_note: {
    purpose: "Pins a note to the hub and the kitchen screen, or unpins it.",
    when: 'For "pin the recycling note" or "take it off the screen".',
    examples: [
      {
        say: "pin the recycling note",
        call: 'pin_note {"noteId": "<id>", "pinned": true}',
      },
    ],
    returns: "`note`: the note as it is now.",
    errors: ["NOT_FOUND"],
    reply: '"Pinned <title>." or "Unpinned <title>."',
  },
  delete_note: {
    purpose: "Deletes a note for everyone.",
    when: "Only when someone clearly asks to remove a note. Name it on the confirm card.",
    examples: [
      {
        say: "delete the recycling note",
        call: 'delete_note {"noteId": "<id>"}',
      },
    ],
    returns: "`noteId` and `title` of the deleted note.",
    errors: ["NOT_FOUND"],
    reply: '"Deleted the note <title>."',
  },
  list_shopping: {
    purpose:
      "The house shopping list, as the kitchen screen shows it. The list is brain's own, so this reads brain back through Olympics.",
    when: "Almost never: brain has the list itself (`baumy_list_items`). It exists so every surface can read it.",
    examples: [
      { say: "(brain reads its own list instead)", call: "list_shopping {}" },
    ],
    returns: "`items`: id, name, when added.",
    errors: CALENDAR_ERRORS,
    reply: "Use brain's own list.",
  },
  list_reminders: {
    purpose:
      "The reminders on the kitchen screen, who has seen each, and the household's active members.",
    when: 'For "any reminders up?" and "who hasn\'t seen the plumber one?". Its `members` is also the roster: use it to turn a housemate\'s name into the member id for X-Baumy-On-Behalf-Of or `doneBy`.',
    examples: [
      {
        say: "who hasn't seen the plumber reminder?",
        call: "list_reminders {}",
      },
    ],
    returns:
      "`members` (id, name, colour, character) and `reminders` (id, title, body, who posted it, when, `seenBy`, `waitingFor`).",
    errors: [],
    reply:
      '"<title>: still waiting for <names of waitingFor>." Name people, never ids.',
  },
  create_reminder: {
    purpose:
      "Posts a full-screen reminder on the kitchen screen until every member has seen it.",
    when: "For something everyone must read (a tradesperson coming, the water off). Not for chores (list_chores) or lasting info (create_note). This is not brain's own timed Telegram reminder: it has no time, it shows now.",
    examples: [
      {
        say: "put up a reminder: plumber Wednesday 9am, leave the door unlocked",
        call: 'create_reminder {"title": "Plumber Wednesday 9:00", "body": "Leave the door unlocked."}',
      },
    ],
    returns: "`reminderId` and `title`.",
    errors: [],
    reply: '"It\'s on the kitchen screen until everyone taps Seen."',
  },
  acknowledge_reminder: {
    purpose:
      "Marks a reminder as seen by the asker (or, on their behalf, a housemate).",
    when: 'For "seen it" / "got it" about a reminder. "Mark it seen for Sam" is X-Baumy-On-Behalf-Of: <Sam\'s id>, which needs the asker\'s confirm tap.',
    examples: [
      {
        say: "seen the plumber one",
        call: 'acknowledge_reminder {"reminderId": "<id>"}',
      },
      {
        say: "mark the plumber reminder seen for Sam, he knows",
        call: 'acknowledge_reminder {"reminderId": "<id>"} with X-Baumy-On-Behalf-Of: <Sam\'s id>',
      },
    ],
    returns:
      "`reminderId`, `memberId` (who it was marked for) and `seenByEveryone`.",
    errors: ["NOT_FOUND"],
    reply:
      '"Marked seen." Add "Everyone has seen it now, it\'s off the screen." when `seenByEveryone`.',
  },
  dismiss_reminder: {
    purpose:
      "Takes a reminder off the kitchen screen for everyone, seen or not.",
    when: "Only when someone asks to take it down (it's no longer true, or it was a mistake).",
    examples: [
      {
        say: "take the plumber reminder down",
        call: 'dismiss_reminder {"reminderId": "<id>"}',
      },
    ],
    returns: "`reminderId` and `title`.",
    errors: ["NOT_FOUND"],
    reply: '"Took <title> off the kitchen screen."',
  },
};
