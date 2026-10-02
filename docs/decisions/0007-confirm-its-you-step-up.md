# 0007: Confirm it's you with any way in, like GitHub's sudo mode

- Status: accepted (2026-10-02); amended the same day after the critic's review of PR #139 (see "Amended" below)

## Context

Owner ruling 2026-10-02 (issue #135): "creating a service token on /admin/connections asks for the password again. It should accept whatever authentication the member has, the way GitHub's sudo mode does."

Before this, three places re-asked for the password unless the session had signed in under 10 minutes ago: creating and rotating a service token, and changing a kiosk PIN (`verifyCurrentPassword`, a password field on each form). A member who signs in with Google or a passkey has no password, so they had to sign out and in again. Members now have up to five ways in: a passkey, a two-factor app, "Sign in with Baumy" from Telegram (ADR 0006), a password and Google.

Better Auth 1.6.25 has no step-up of its own. It has a "fresh session" check (`freshSessionMiddleware`, a day by default) that only looks at when the session was made. Its passkey plugin's `/passkey/verify-authentication` always makes a NEW session, so it cannot confirm a session that already exists. It also makes new sessions on paths that prove nothing: turning two-factor on (the enrolment's code check) and off swap in a session with a fresh `createdAt`.

## Decision

- **One server gate.** `requireRecentAuth(ctx)` (`apps/web/lib/auth/recent-auth.ts`) lets a sensitive change through only while this request's session has an open sudo window. Otherwise it answers `REAUTH_REQUIRED`. A session's age never counts. Sensitive changes call it inside `execute`. Today: `create_service_token`, `rotate_service_token`, `revoke_service_token`, `set_kiosk_pin` when it replaces a PIN, `remove_passkey`, `unlink_google` and `set_first_password` (a first password is a new way in that a thief could then sign in with; added after the critic's review of PR #148).
- **The window is server-side and bound to the session.** A `step_ups` row keyed by Better Auth's `session.id` (FK, cascade): `method`, `confirmed_at`, `expires_at` (10 minutes). Another device, or another session of the same account, has none; signing the session out drops it. Nothing secret is stored. It is a table of ours rather than a column on Better Auth's `session` table, which Better Auth owns and caches in its cookie.
- **Two ways to open it:**
  - **a real sign-in** opens one for the session it makes. This is an after-hook in `packages/auth/src/step-up.ts` on `/sign-in/email`, `/sign-up/email`, `/callback/:id` (Google), `/passkey/verify-authentication`, Sign in with Baumy (`/sign-in/baumy-approval`) and the sign-in code step (`/two-factor/verify-totp` or `/verify-backup-code`, only when the request carries the challenge cookie a correct password set). A password sign-in that two-factor turns into a code step opens nothing: Better Auth deletes the session it made;
  - **confirming it is you** (`confirm_identity`), below.
- **Better Auth's own security endpoints need an open window too.** A before-hook in the same plugin refuses them with `STEP_UP_REQUIRED`:
  - registering a passkey (`/passkey/generate-register-options`, `/passkey/verify-registration`);
  - `/two-factor/enable`, `/disable`, `/generate-backup-codes` and `/get-totp-uri`;
  - the code checks (`/two-factor/verify-totp`, `/verify-backup-code`, `/verify-otp`) when a session comes with them. That is the enrolment step; without a session they are the sign-in step and pass.

  `session.freshAge` is 0, which Better Auth 1.6.25 reads as "off": the window is the only check on registering a passkey. Better Auth's default of a day let a stolen session add a passkey. 600 seconds (briefly, in PR #148) refused a member who had just confirmed it's them, because that check looks only at the session's age.

- **One client dialog.** A form wraps its server action in `useStepUp().guard` (`apps/web/components/account/confirm-its-you.tsx`). On `REAUTH_REQUIRED` the dialog opens with only the methods this member has (`get_step_up`), and after a success the same request is sent again. Better Auth's own endpoints (the two-factor and passkey cards) call `useStepUp().ensure()` before they start. The next sensitive change within 10 minutes does not open the dialog.
- **Every method the member has, each checked by Better Auth or by our existing approval flow** (`confirm_identity`):
  - **Passkey.**
    - The browser asks Better Auth's passkey plugin for a challenge (`/passkey/generate-authenticate-options`, which, signed in, lists only this account's passkeys) and runs the browser's prompt.
    - The assertion goes to `confirm_identity`, which calls a `SERVER_ONLY` endpoint of ours (`verifyStepUpPasskey`, like `approvalSignIn`).
    - It runs the same checks as the plugin's verify, with the same `@simplewebauthn/server` call: the challenge is used once, and the origin, rp id, signature and counter must match.
    - It adds two checks of its own: the challenge was made for this session's user, and the passkey is theirs. It makes no session.
    - `@simplewebauthn/server` (server) and `@simplewebauthn/browser` (client) become direct dependencies, at the versions Better Auth's passkey plugin already pulls in.
  - **Two-factor code.**
    - A `SERVER_ONLY` endpoint (`verifyStepUpTotp`) decrypts the finished enrolment's secret with Better Auth's `symmetricDecrypt` and checks the code with `@better-auth/utils/otp`, over the same window as Better Auth (this step and one either side). It answers the step the code matched.
    - `confirm_identity` takes that step once per account (`step_up_totp_steps`, one upsert guarded by `last_step < step`). A code read over the member's shoulder, or sent twice, is refused, and so is an older one.
    - Better Auth's own `verifyTOTP` is not used: with a session it is the enrolment step, which swaps the session (and is now guarded).
    - `confirm_identity`'s rate limit (10 per member in 15 minutes) bounds guessing.
    - Better Auth's sign-in code step does not consult `step_up_totp_steps`.
  - **Sign in with Baumy** (ADR 0006), when `SIGN_IN_WITH_BAUMY=on` and the member is linked.
    - `request_baumy_confirmation` stores a `login_requests` row with `purpose = step_up` and this `session_id`. Brain DMs "Confirm it's you on <device>?" with the number and four decoys (`purpose: "step_up"` in the call).
    - The tap is `approve_login` / `deny_login`, unchanged. The page polls `get_baumy_confirmation`.
    - Once the request is approved, `confirm_identity` claims it with one `UPDATE … RETURNING` for this session and this member. No session is made.
    - The sign-in path never sees a step-up row, and the reverse holds too.
    - A denial turns the method off for 15 minutes, as for sign-in.
  - **Password**, only when the account has one: Better Auth's `verifyPassword`.
  - **Google**, when linked and configured: a fresh Google sign-in. The dialog asks Better Auth for Google's URL and sets `prompt=login` and `max_age=0` on it, so Google asks for the password again. The new session's window comes from the sign-in hook. It is the only method that makes a session, because Google re-auth is a sign-in.
    - **Limit:** Better Auth 1.6.25 sets `prompt` only for the whole provider and does not expose or check the id token's `auth_time`. So the re-prompt is the browser's request, not something the server verifies. A browser that drops the parameters still gets a window, as any Google sign-in does.
- **Ledger, audit, limits.** `confirm_identity`'s fingerprint keeps only the method, so the password, the code and the assertion reach neither `input_hash` nor the audit row. A success is audited as the step-up itself (`entity: session`, the session id, the method and when the window closes). A failure rolls back and is not audited. It is rate-limited, and refused before any check once the limit is spent.

## Amended 2026-10-02 (the critic's review of PR #139)

PR #139 counted a session signed in under 10 minutes ago as recently authenticated, through `session.createdAt`. Two holes followed:

- Better Auth swaps in new sessions when two-factor is turned on (the enrolment's code check) or off (`allowPasswordless: true`). So a stolen session of a passwordless member could make itself a fresh session, and with it 10 minutes of sudo, again and again.
- Registering a passkey needed only Better Auth's one-day freshness. A thief's new passkey would then pass `confirm_identity`.

The amendment:

- stops trusting age;
- opens windows on real sign-ins only;
- guards the passkey and two-factor endpoints;
- turns Better Auth's age-based `freshAge` off (0), so the window is the only check;
- takes each two-factor code once;
- re-prompts Google;
- needs a window for `set_first_password` too.

## Consequences

- No sensitive form has a password field any more. A Google-only or passkey-only member confirms with what they have.
- **Better Auth still demands the password where it does so itself**, because 1.6.25 has no API that accepts another proof there: turning two-factor on or off and making new backup codes (`shouldRequirePassword`, when the account has a password), and changing the password. The Security page keeps those password fields, and asks "Confirm it's you" first.
- Turning two-factor on or off swaps in a session with no window. The next sensitive change asks again.
- A stolen session gets sudo only if its thief can also pass one of the member's methods.
- Brain should read `purpose` to word the DM (RyRy79261/baumy-brain follow-up issue). A brain that ignores it still works, but says "Sign in" for a confirmation.
