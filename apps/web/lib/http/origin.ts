import { resolveTrustedOrigins } from "@baumy/auth/env";

// CSRF defence for cookie-authenticated POST route handlers (SPEC §9,
// AGENTS.md "Security"). Server actions get Next's built-in origin check;
// route handlers such as /api/actions/run, /api/ai/command and uploads do
// not, so they call `rejectCrossSite(request)` first.
//
// A browser always sends `Sec-Fetch-Site` on a fetch from a page, and it
// cannot be set by script. When it is missing (older browsers), `Origin` must
// name this host or a trusted deployment origin. A POST with neither is
// refused: a cookie-carrying browser request always has one of them.

/** True when the request comes from this app's own pages. */
export function isSameOriginRequest(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";

  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && originUrl.host === host) return true;
  return resolveTrustedOrigins(env).includes(originUrl.origin);
}

/** A 403 for a cross-site request, or null to carry on. */
export function rejectCrossSite(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): Response | null {
  if (isSameOriginRequest(req, env)) return null;
  return Response.json(
    { ok: false, code: "FORBIDDEN", message: "Cross-site request refused." },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
