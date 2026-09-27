import { toNextJsHandler } from "better-auth/next-js";
import { authMayServe, getAuth } from "@baumy/auth";

// Self-hosted Better Auth (ADR 0001), mounted in this app's own process. It
// serves the whole auth surface at /api/auth/*: sign-up, sign-in, sign-out,
// the session, the Google callback and password reset. Ported from camp-404
// `apps/web/app/api/auth/[...path]/route.ts`.
//
// The instance is built on the first request, not at import, so `next build`
// collecting this route constructs nothing.

/**
 * A Vercel deployment without BETTER_AUTH_SECRET answers 503 instead of
 * minting sessions signed with the public placeholder (see `authMayServe`).
 */
function closed(): Response {
  return Response.json(
    {
      message:
        "Sign-in is switched off on this deployment until BETTER_AUTH_SECRET is set.",
    },
    { status: 503 },
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!authMayServe(process.env)) return closed();
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  if (!authMayServe(process.env)) return closed();
  return toNextJsHandler(getAuth()).POST(request);
}
