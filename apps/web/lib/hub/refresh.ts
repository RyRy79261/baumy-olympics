// The kitchen screen's re-read (SPEC §8, §6.6, issue #26). Every 60 seconds
// and on focus it re-reads the page (components/hub/auto-refresh.tsx), and
// marks that request with a short-lived cookie so the server skips its
// 30-second cache of brain's shopping list: something added in Telegram
// shows on the kitchen screen within the minute. Client-safe constants; the
// server half is `skipShoppingCacheOnRefresh` (refresh-server.ts).

/** The cookie that marks a request as the kitchen screen's own re-read. */
export const REFRESH_COOKIE = "baumy_refresh";
/** Long enough for the refresh's request, short enough not to linger. */
export const REFRESH_COOKIE_MAX_AGE_S = 10;

/** The `document.cookie` line that marks the next request. */
export function refreshCookieLine(): string {
  return `${REFRESH_COOKIE}=1; path=/; max-age=${REFRESH_COOKIE_MAX_AGE_S}; samesite=strict`;
}
