# 0006: Sign in by approving it from Telegram, with number matching

- Status: accepted (2026-09-28)

## Context

Owner ruling 2026-09-28 (issue #80): no Telegram login widget on the tablet; instead "an approve this login pop up from baumy". Typing a password on the kitchen iPad (or on a friend's laptop) is the thing to avoid. Every member who uses brain has already linked their Telegram account (`members.telegram_user_id`, ADR 0003), and brain can already put buttons in front of them.

A plain "Approve?" push is the weak form of this: people approve pushes they did not ask for ("MFA fatigue"). Number matching fixes that: the screen shows a number and the push asks which one, so approving means looking at the screen.

## Decision

- **Flow.**
  1. The sign-in page's **Sign in with Baumy** asks for an email and calls `POST /api/login-approval/start`.
  2. Olympics stores a `login_requests` row (2-minute TTL): the member, the sha256 of a random browser secret, the number, the number plus four decoys, a short device name ("Chrome on macOS"). The browser gets the secret as an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/login-approval`, and the number to show.
  3. After the response, Olympics writes the `request_login` audit row and calls brain's `POST /api/kitchen/login-approval` (`KITCHEN_API_TOKEN`, like the shopping API). Brain DMs the member's linked Telegram account "Sign in on Chrome on macOS? Tap the number on the screen", with the five numbers and **Deny** as buttons.
  4. The tap comes back through `/api/v1/actions`: `approve_login {requestId, code}` or `deny_login {requestId}`. Both are brain-only, `ownWordOnly`, run as the tapping member, and only for a request made for that member. A decoy denies the request. Any denial (Deny or a decoy) turns the method off for that member for 15 minutes, against push fatigue; the password still works.
  5. The browser polls `GET /api/login-approval/status` (its cookie, nothing in the URL). On `approved` it calls `POST /api/login-approval/exchange` once, which claims the request with one `UPDATE … RETURNING` and makes a Better Auth session.
- **Off until switched on.** `SIGN_IN_WITH_BAUMY=on` shows the button and serves the three routes (404 otherwise). The owner turns it on once the brain side is deployed (SETUP.md).
- **The session is Better Auth's own, and short.** A small plugin (`packages/auth/src/approval-sign-in.ts`) adds a `SERVER_ONLY` endpoint (`auth.api.signInApproved`): Better Auth's router does not mount it, so only the exchange route, having decided, can call it. It uses `internalAdapter.createSession` and `setSessionCookie` with `dontRememberMe`: a browser session (the cookie has no Max-Age) that the server ends after a day at most, not the 30 days of a password sign-in. The session list shows it with the device's user agent and IP.
- **Enumeration-safe.** Every well-formed address gets the same answer: a stored request, a cookie, a number and "If this account is linked to Telegram, Baumy has sent you a message". The lock lookup runs for every address. Only an active member with an account and a linked Telegram id, not locked, gets the audit row and the DM, and both happen in `after()`, so the response time does not tell. The rate limits are per IP and per address (hashed), whether or not an account exists.
- **Not actions.** Start, status and exchange are a sign-in, like Better Auth's routes or the kiosk pairing: nobody is signed in yet. The member's decision is the action. The request's audit row (`request_login`) has no actor (`audit_events.actor_member_id` is null, migration 0015): the requester is anonymous, the member is the target (`entity` `member`), and the IP and device are in `payload`. With the kiosk PIN lock, it is one of the two audit rows written outside `runAction`.

## Consequences

- A stolen Telegram account can sign in as its member, but only while someone watches the screen that asked: the number is shown there, never sent anywhere else. The password still works; this adds a way in, it does not replace one.
- This path makes a session without a TOTP step. ~~Whether a Telegram tap counts as the second factor once two-factor arrives (issue #79) is the owner's call [UNRESOLVED 2026-09-28]; until then it **fails closed**: a user with `two_factor_enabled` gets no DM (`findLoginCandidate`, the same neutral screen) and `signInApproved` refuses them (`userHasTwoFactor`, packages/db/src/login-requests.ts). [CORRECTION 2026-09-28] Since #79 added `user.two_factor_enabled` (migration 0016), the check reads the column directly.~~
- **Resolved 2026-09-29 (owner ruling, issue #95): "1 baumy tap is fine".** For a member with two-factor on, tapping the matching number in Telegram counts as the second factor: they get the DM like anyone else, and the approved request becomes a session with no code step. `findLoginCandidate` no longer filters on `two_factor_enabled`, `signInApproved` no longer refuses such a user, and `userHasTwoFactor` is gone. Better Auth's own two-factor hook watches only the password sign-in paths (`/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number` in 1.6.25), so it does not step in on this one. The reasoning: the sign-in needs the member's linked Telegram account and someone looking at the screen that shows the number (a decoy tap blocks it), which is the same "something you have plus the device in front of you" that already lets a passkey or Google skip the code. SPEC §12 decision 19.
- Brain must never let its LLM reach these actions: they are called from the DM's buttons only (`docs/brain-operations-spec.md`). A button tap is the confirmation, so `approve_login` is `confirm`-risk and the tap sends `X-Baumy-Confirmed: 1`.
- The daily sweep deletes requests older than a day; the audit rows stay.
- If brain is down, the screen simply waits and expires; the page offers the password.
