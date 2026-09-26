# 0001: Self-hosted Better Auth over Neon Auth

- Status: accepted (2026-09-27)
- Deciders: Ryan

## Context

Neon Auth (`@neondatabase/auth`, used in intake-tracker) runs Better Auth as a service hosted by Neon. It broke the Android app, and intake-tracker needed a whole native-auth bridge to work around it (`apps/web/src/app/api/native-auth/{mint,claim}`). camp-404 and afrikaburn instead run **Better Auth 1.6.25 inside the app's own process**, against the app's own Postgres tables. That is the "custom login" the owner means: nothing is hand-rolled, but nothing is hosted by a third party either.

We also need two things that are not ordinary user sessions:

- a kitchen kiosk that stays signed in for a year and acts for whoever taps their avatar;
- machine callers (baumy-brain and MCP clients).

## Decision

1. **Better Auth `1.6.25`, pinned exactly and excluded from Dependabot**, in `packages/auth`. Port these from camp-404:
   - `packages/auth/src/config.ts` and `env.ts`;
   - `apps/web/app/api/auth/[...path]/route.ts`;
   - `apps/web/lib/auth.ts`.
2. **Sign-in methods:** email and password, with Google optional. `changeEmail` is off. Auth fails closed without `BETTER_AUTH_SECRET` (`authMayServe`). The rate-limit storage is the database.
3. **The `bearer()` plugin is on from day one**, so a future native shell can authenticate without cookies.
4. **Three more kinds of credential, all opaque random tokens stored as sha256 hashes** (unlike Better Auth's own `session.token`, which 1.6.25 stores in plaintext):
   - `kiosk_devices`, paired with a one-time code that an admin creates;
   - `service_tokens` for baumy-brain;
   - MCP OAuth tokens (intake-tracker's pattern).
5. **One `getActor()` resolver** returns `Actor = {kind: "member" | "kiosk" | "service" | "mcp", memberId?, ...}`. `runAction` is the only thing that decides what an actor may do.
6. **Kiosk attestation:** attesting (confirming, disputing or vouching for a completion) on the kiosk needs the member's PIN, sent and verified per request. The PIN is hashed with scrypt, allows 5 attempts per 15 minutes and 10 per 24h before it locks, and is set from the member's own session. Admin actions and personal settings (PIN, Telegram link codes, MCP connections) need `requireSession`, a real session, and are never available to a kiosk actor.

## Consequences

- **Good:** we control the schema and the migrations. The auth tables live in our Neon DB, so there is no extra vendor. The camp-404 code and tests are known to work.
- **Cost:** Better Auth CVEs have to be watched by hand, as better-auth is excluded from Dependabot. There is also a 5-minute revocation lag from the cookie cache.
- **Traps:** do not relax `requireLocalEmailVerified`, and keep sign-in and forgot-password enumeration-safe.
