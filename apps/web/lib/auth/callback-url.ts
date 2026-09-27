// Where to go after signing in (`/auth/sign-in?callbackURL=…`), from intake-
// tracker `src/app/auth/sign-in-form.tsx` (`safeCallbackUrl`). Only a path on
// this site: anything that could leave it (`//evil`, `/\evil`, a scheme) is
// replaced with home, so the parameter cannot become an open redirect.
// Pure and client-safe.

export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw || raw.length > 4000) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  // Control characters and backslashes are never in a path we send here.
  for (const ch of raw) {
    if (ch === "\\" || ch.charCodeAt(0) < 0x20) return "/";
  }
  return raw;
}

/** `/auth/sign-in`, returning to `path` afterwards. */
export function signInUrl(path?: string): string {
  const back = safeCallbackUrl(path);
  return back === "/"
    ? "/auth/sign-in"
    : `/auth/sign-in?callbackURL=${encodeURIComponent(back)}`;
}
