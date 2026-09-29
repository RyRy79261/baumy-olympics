// The kiosk's one-shot walk-in cookie (issue #111). Pure and client-safe:
// no node imports, because components/kiosk/forget-cookie.tsx (a client
// component) needs its name, and lib/kiosk/cookies.ts imports node:crypto.

/**
 * `baumy_kiosk_walk_in` (issue #111): set by the tap that picks a member,
 * for a minute, to the member's id; the dashboard plays that member's walk
 * pose once for it and the screen forgets it at once
 * (components/kiosk/forget-cookie.tsx), so going back to Home later does
 * not walk them in again. Not HttpOnly, so the screen can clear it; it
 * holds nothing but a member id the screen already shows.
 */
export const KIOSK_WALK_IN_COOKIE = "baumy_kiosk_walk_in";
export const KIOSK_WALK_IN_MAX_AGE_S = 60;

export function walkInCookieOptions() {
  return {
    httpOnly: false,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: KIOSK_WALK_IN_MAX_AGE_S,
  };
}

/** Whether the dashboard should walk `memberId` in: they were just tapped. */
export function walksIn(
  cookie: string | undefined,
  memberId: string | undefined,
): boolean {
  return memberId !== undefined && cookie === memberId;
}
