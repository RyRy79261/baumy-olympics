// One-tap Telegram linking (issue #108). /settings makes a one-time link code
// (`create_telegram_link_code`) and turns it into a Telegram deep link:
// opening https://t.me/<bot>?start=link_<code> shows the bot's Start button,
// and tapping it sends `/start link_<code>` from the member's own DM, which
// baumy-brain redeems exactly like `/link <code>` (docs/brain-integration.md).
// Pure, so the page and the tests build the same link.

export const TELEGRAM_BOT_USERNAME_ENV = "TELEGRAM_BOT_USERNAME";
/** The live house bot (baumy-brain). */
export const DEFAULT_TELEGRAM_BOT_USERNAME = "baumy_bot";
/** What Telegram puts before the code in the start payload. */
export const START_LINK_PREFIX = "link_";

/** Telegram usernames: 5 to 32 letters, digits and underscores, from a letter. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
/** A start payload may hold only these, at most 64 of them. */
const START_PAYLOAD = /^[A-Za-z0-9_-]{1,64}$/;

type Env = Record<string, string | undefined>;

/**
 * The bot's username from `TELEGRAM_BOT_USERNAME` (a leading "@" is fine),
 * or `baumy_bot` when it is unset or not a Telegram username.
 */
export function telegramBotUsername(env: Env = process.env): string {
  const raw = env[TELEGRAM_BOT_USERNAME_ENV]?.trim().replace(/^@/, "") ?? "";
  return USERNAME.test(raw) ? raw : DEFAULT_TELEGRAM_BOT_USERNAME;
}

/** https://t.me/<bot>?start=link_<code>; throws on a code Telegram would drop. */
export function telegramLinkDeepLink(
  code: string,
  botUsername: string,
): string {
  const payload = `${START_LINK_PREFIX}${code}`;
  if (!START_PAYLOAD.test(payload)) {
    throw new Error(
      "A Telegram start payload holds only A-Z, a-z, 0-9, _ and -.",
    );
  }
  return `https://t.me/${botUsername}?start=${payload}`;
}
