# 0007: Confirm it's you with any way in, like GitHub's sudo mode

- Status: accepted (2026-10-02)

## Context

Owner ruling 2026-10-02 (issue #135): "creating a service token on /admin/connections asks for the password again. It should accept whatever authentication the member has, the way GitHub's sudo mode does."

Before this, three places re-asked for the password unless the session had signed in under 10 minutes ago: creating and rotating a service token, and changing a kiosk PIN (`verifyCurrentPassword`, a password field on each form). A member who signs in with Google or a passkey has no password, so they had to sign out and in again. Members now have up to five ways in: a passkey, a two-factor app, "Sign in with Baumy" from Telegram (ADR 0006), a password and Google.

Better Auth 1.6.25 has no step-up of its own. It has a "fresh session" check (`freshSessionMiddleware`, a day by default) that only looks at when the session was made. Its passkey plugin's `/passkey/verify-authentication` always makes a NEW session, so it cannot confirm a session that already exists.

## Decision

- **One server gate.** `requireRecentAuth(ctx)` (`apps/web/lib/auth/recent-auth.ts`) lets a sensitive change through when this request's session signed in under 10 minutes ago, or confirmed it is its member in the last 10 minutes. Otherwise it answers `REAUTH_REQUIRED`. Sensitive changes call it inside `execute`, before they share-lock the session row (PR #105's ordering). Today: `create_service_token`, `rotate_service_token`, `revoke_service_token`, `set_kiosk_pin` when it replaces a PIN, `remove_passkey` and `unlink_google`.
- **The window is server-side and bound to the session.** A `step_ups` row keyed by Better Auth's `session.id` (FK, cascade): `method`, `confirmed_at`, `expires_at` (10 minutes). Another device, or another session of the same account, has none; signing the session out drops it. Nothing secret is stored. It is a table of ours rather than a column on Better Auth's `session` table, which Better Auth owns and caches in its cookie.
- **One client dialog.** A form wraps its server action in `useStepUp().guard` (`apps/web/components/account/confirm-its-you.tsx`). On `REAUTH_REQUIRED` the dialog opens with only the methods this member has (`get_step_up`), and after a success the same request is sent again. The next sensitive change within 10 minutes does not open it.
- **Every method the member has, each checked by Better Auth or by our existing approval flow** (`confirm_identity`):
  - **Passkey.** The browser asks Better Auth's passkey plugin for a challenge (`/passkey/generate-authenticate-options`, which, signed in, lists only this account's passkeys) and runs the browser's prompt. The assertion goes to `confirm_identity`, which calls a `SERVER_ONLY` Better Auth endpoint of ours (`packages/auth/src/step-up.ts`, like `approvalSignIn`). It runs the same checks as the plugin's verify, with the same `@simplewebauthn/server` call: the challenge is used once, and the origin, rp id, signature and counter must match. It adds two checks of its own, that the challenge was made for this session's user and that the passkey is theirs. It makes no session. `@simplewebauthn/server` (server) and `@simplewebauthn/browser` (client) become direct dependencies, at the versions Better Auth's passkey plugin already pulls in.
  - **Two-factor code.** Better Auth's `verifyTOTP`, called with this request's headers: with a session it checks the code against the account's secret and returns. It would also finish an unverified enrolment (turning two-factor on), so it is offered and called only when two-factor is on and verified. Better Auth counts no failures for a signed-in session, so `confirm_identity`'s rate limit (10 per member in 15 minutes) is the guard.
  - **Sign in with Baumy** (ADR 0006), when `SIGN_IN_WITH_BAUMY=on` and the member is linked. `request_baumy_confirmation` stores a `login_requests` row with `purpose = step_up` and this `session_id`, and brain DMs "Confirm it's you on <device>?" with the number and four decoys (`purpose: "step_up"` in the call). The tap is `approve_login` / `deny_login`, unchanged. The page polls `get_baumy_confirmation`; once the request is approved, `confirm_identity` claims it with one `UPDATE … RETURNING` for this session and this member. The sign-in path never sees a step-up row, and the reverse holds too. No session is made. A denial turns the method off for 15 minutes, as for sign-in.
  - **Password**, only when the account has one: Better Auth's `verifyPassword`.
  - **Google**, when linked and configured: a fresh Google sign-in (`signIn.social`). It leaves the page, and the new session counts as signed in under 10 minutes ago. This is the only method that makes a session, because Google re-auth is a sign-in.
- **Ledger, audit, limits.** `confirm_identity`'s fingerprint keeps only the method, so the password, the code and the assertion reach neither `input_hash` nor the audit row. A success is audited as the step-up itself (`entity: session`, the session id, the method and when the window closes). A failure rolls back and is not audited. It is rate-limited, and refused before any check once the limit is spent.

## Consequences

- No sensitive form has a password field any more. A Google-only or passkey-only member confirms with what they have.
- **Better Auth still demands the password where it does so itself**, because 1.6.25 has no API that accepts another proof there: turning two-factor on or off and making new backup codes (`shouldRequirePassword`, when the account has a password), and changing the password. The Security page keeps those password fields. Adding a passkey still needs only Better Auth's fresh-session check, as before.
- A stolen session has 10 minutes of sudo only if its thief can also pass one of the member's methods, or if it signed in under 10 minutes ago. That second case was already true before this change.
- Brain should read `purpose` to word the DM. A brain that ignores it still works, but says "Sign in" for a confirmation.
