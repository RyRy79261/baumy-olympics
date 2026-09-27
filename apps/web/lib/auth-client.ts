"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The Better Auth client for the web app: same-origin fetches to this app's
 * /api/auth/*, so no base URL is needed. A native shell would use the
 * `set-auth-token` header and `Authorization: Bearer` instead of cookies.
 */
export const authClient = createAuthClient();
