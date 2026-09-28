# 0006: Sign in by approving it from Telegram, with number matching

- Status: accepted (2026-09-28)

## Context

Owner ruling 2026-09-28 (issue #80): no Telegram login widget on the tablet; instead "an approve this login pop up from baumy". Typing a password on the kitchen iPad (or on a friend's laptop) is the thing to avoid. Every member who uses brain has already linked their Telegram account (`members.telegram_user_id`, ADR 0003), and brain can already put buttons in front of them.

A plain "Approve?" push is the weak form of this: people approve pushes they did not ask for ("MFA fatigue"). Number matching fixes that: the screen shows a number and the push asks which one, so approving means looking at the screen.

## Decision

- **Flow.**
  1. The sign-in page's **Sign in with Baumy** asks for an email and calls `POST /api/login-approval/start`.
  2. Olympics stores a `login_requests` row (2-minute TTL): the member, the sha256 of a random browser secret, the number, the number plus two decoys, a short device name ("Chrome on macOS"). The browser gets the secret as an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/login-approval`, and the number to show.
  3. After the response, Olympics calls brain's `POST /api/kitchen/login-approval` (`KITCHEN_API_TOKEN`, like the shopping API). Brain DMs the member's linked Telegram account "Sign in on Chrome on macOS? Tap the number on the screen", with the three numbers and **Deny** as buttons.
  4. The tap comes back through `/api/v1/actions`: `approve_login {requestId, code}` or `deny_login {requestId}`. Both are brain-only, `ownWordOnly`, run as the tapping member, and only for a request made for that member. A decoy denies the request and turns the method off for that member for 15 minutes.
  5. The browser polls `GET /api/login-approval/status` (its cookie, nothing in the URL). On `approved` it calls `POST /api/login-approval/exchange` once, which claims the request with one `UPDATE … RETURNING` and makes a Better Auth session.
- **The session is Better Auth's own.** A small plugin (`packages/auth/src/approval-sign-in.ts`) adds a `SERVER_ONLY` endpoint (`auth.api.signInApproved`): Better Auth's router does not mount it, so only the exchange route, having decided, can call it. It uses `internalAdapter.createSession` and `setSessionCookie`, exactly as the built-in sign-ins do, so the session has the device's user agent and IP and the session list shows it.
- **Enumeration-safe.** Every well-formed address gets the same answer: a stored request, a cookie, a number and "If this account is linked to Telegram, Baumy has sent you a message". Only an active member with an account and a linked Telegram id, not locked, is messaged, and the message goes out in `after()`, so the response time does not tell. The rate limits are per IP and per address (hashed), whether or not an account exists.
- **Not actions.** Start, status and exchange are a sign-in, like Better Auth's routes or the kiosk pairing: nobody is signed in yet. The member's decision is the action. The request's audit row (`request_login`, for a real member only) is written with the row in one transaction by the start route; with the kiosk PIN lock, it is one of the two audit rows written outside `runAction`.

## Consequences

- A stolen Telegram account can sign in as its member, but only while someone watches the screen that asked: the number is shown there, never sent anywhere else. The password still works; this adds a way in, it does not replace one.
- When two-factor arrives (issue #79), this path makes a session without a TOTP step. Decide then whether a Telegram tap counts as the second factor or whether this path must ask for it too. [UNRESOLVED 2026-09-28]
- Brain must never let its LLM reach these actions: they are called from the DM's buttons only (`docs/brain-operations-spec.md`). A button tap is the confirmation, so `approve_login` is `confirm`-risk and the tap sends `X-Baumy-Confirmed: 1`.
- The daily sweep deletes requests older than a day; the audit rows stay.
- If brain is down or not set up, the button is still shown (when configured) and the screen simply waits and expires; the page offers the password.
