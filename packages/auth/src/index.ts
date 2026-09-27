// @baumy/auth: self-hosted Better Auth (ADR 0001), ported from camp-404's
// @camp404/auth.
//
//   Route handler, apps/web/app/api/auth/[...path]/route.ts:
//     toNextJsHandler(getAuth()), wrapped in `authMayServe`.
//   Server read, apps/web/lib/auth.ts: getAuth().api.getSession({ headers }),
//     which accepts the session cookie or `Authorization: Bearer`.
//   Client, apps/web/lib/auth-client.ts: built in the app, client-only.
//
// The pure env resolvers are also published as `@baumy/auth/env`, and the
// password policy as `@baumy/auth/password`, which client components import.

export {
  buildAuthOptions,
  createAuth,
  getAuth,
  PLACEHOLDER_SECRET,
  type Auth,
} from "./config";
export {
  buildAuthEmail,
  sendAuthEmail,
  type AuthEmailKind,
  type CapturedAuthEmail,
} from "./email";
export {
  AUTH_COOKIE_PREFIX,
  AUTH_SESSION,
  authConfigWarnings,
  authMayServe,
  canDeliverAuthEmail,
  isAuthConfigured,
  isEmailProviderConfigured,
  isFounderEmail,
  isGoogleConfigured,
  resolveAuthEmailCaptureFile,
  resolveBaseURL,
  resolveFounderEmails,
  resolveTrustedOrigins,
  type AuthEnv,
} from "./env";
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";
