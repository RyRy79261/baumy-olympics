// Request and response plumbing for the MCP OAuth endpoints (SPEC §6.3),
// ported from intake-tracker `apps/web/src/lib/mcp/cors.ts`,
// `oauth-request.ts` and the HTML helpers of its authorize route.

/**
 * claude.ai calls the metadata, registration and token endpoints from
 * another origin. Tokens travel in headers or bodies, never cookies, so a
 * wildcard origin is safe. `WWW-Authenticate` is exposed for issue #24's
 * `Bearer resource_metadata=` hint.
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Authorization, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "WWW-Authenticate",
  "access-control-max-age": "86400",
};

/** RFC 6749 §5.1: token responses are never cached, success or error. */
export const NO_STORE: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  pragma: "no-cache",
};

export function corsJson(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, ...NO_STORE, ...extra },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** An RFC 6749 §5.2 error: `{error, error_description}`, never cached. */
export function oauthError(
  error: string,
  description: string,
  status = 400,
): Response {
  return corsJson({ error, error_description: description }, status);
}

/**
 * A form-encoded or JSON body as string fields. An empty or broken body is a
 * parse error to report, never a throw (intake's fuzz tests found both).
 */
export async function readBody(
  req: Request,
): Promise<{ ok: true; fields: Record<string, string> } | { ok: false }> {
  const type = req.headers.get("content-type") ?? "";
  try {
    const fields: Record<string, string> = {};
    if (type.includes("application/json")) {
      const text = await req.text();
      const json: unknown = text.trim() ? JSON.parse(text) : {};
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        return { ok: false };
      }
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === "string") fields[k] = v;
      }
      return { ok: true, fields };
    }
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") fields[k] = v;
    }
    return { ok: true, fields };
  } catch {
    return { ok: false };
  }
}

/** `Authorization: Basic base64(id:secret)` (RFC 6749 §2.3.1), or null. */
export function basicClientCredentials(
  req: Request,
): { clientId: string; clientSecret: string } | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, i)),
      clientSecret: decodeURIComponent(decoded.slice(i + 1)),
    };
  } catch {
    return null;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

function page(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${escapeHtml(title)}</title></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * Navigate to another site with a page, not a 302 (intake-tracker gotcha #4):
 * a CSP `form-action 'self'` also applies to where a form POST redirects, so
 * a 302 from the consent form to claude.ai would be dropped silently. A page
 * that navigates is a normal document load. Meta refresh, script and a link,
 * so it works without JavaScript too.
 */
export function htmlRedirect(target: string): Response {
  const href = escapeHtml(target);
  return page(
    "Redirecting",
    `<meta http-equiv="refresh" content="0;url=${href}">` +
      `<p>Taking you back… <a href="${href}">Continue</a> if nothing happens.</p>` +
      `<script>window.location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")});</script>`,
    200,
  );
}

/** A dead end the person can read: what went wrong, and where to go. */
export function htmlError(message: string, status = 400): Response {
  return page(
    "Could not connect",
    `<main><h1>Could not connect to Baumy</h1><p role="alert">${escapeHtml(message)}</p>` +
      `<p><a href="/">Back to Baumy</a></p></main>`,
    status,
  );
}
