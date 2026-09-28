"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * The Better Auth client for the web app: same-origin fetches to this app's
 * /api/auth/*, so no base URL is needed. A native shell would use the
 * `set-auth-token` header and `Authorization: Bearer` instead of cookies.
 *
 * The plugin clients mirror the server plugins in @baumy/auth (issue #79,
 * as camp-404 `apps/web/lib/auth-client.ts`):
 *   - twoFactorClient: authClient.twoFactor.enable / verifyTotp /
 *     verifyBackupCode / disable / generateBackupCodes. A password sign-in
 *     that needs the code answers `twoFactorRedirect` instead of a session,
 *     and the sign-in form shows the code step in place, so no redirect is
 *     wired here.
 *   - passkeyClient: authClient.passkey.addPasskey, authClient.signIn.passkey.
 * Renaming and removing a passkey, signing devices out, unlinking Google and
 * a first password are actions (lib/actions/account-security.ts).
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient()],
});
