import {
  FREQUENCY_V1,
  PHOTO_RETENTION_DAYS as PHOTO_DAYS,
  RULESET_V1,
} from "@baumy/core";
import { KIOSK_PAIRING_TTL_MS } from "@baumy/db/kiosk-pairing";
import { TELEGRAM_LINK_CODE_TTL_MS } from "@baumy/db/telegram-link-codes";
import { KIOSK_PIN_MAX_DIGITS, KIOSK_PIN_MIN_DIGITS } from "@baumy/types";
import { MAX_RECORDING_MS } from "@/lib/ai/voice";
import { NEW_BOUNTY_MS } from "@/lib/chores/urgency";
import { KIOSK_IDLE_MS, SCREENSAVER_IDLE_MS } from "@/lib/kiosk/constants";
import { DEFAULT_NIGHT_WINDOW } from "@/lib/kiosk/night";
import { DEFAULT_TELEGRAM_BOT_USERNAME } from "@/lib/telegram/deep-link";

// The numbers the manual (docs/manual/*.md) may name, as `{{NAME}}`
// placeholders, each read from the constant the code uses (issue #142), the
// way app/privacy/page.tsx reads its own: change the code and the corpus
// changes with it. A placeholder that is not here fails the build of the
// corpus, and so does a constant here that no page uses.
//
// Security internals (rate limits, PIN lockout) are deliberately not here:
// the manual explains how things work, not how to get around them.

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** `390` minutes after midnight → `06:30`. */
function clockTime(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export const HELP_CONSTANTS: Readonly<Record<string, string | number>> = {
  // Scoring (SPEC §4.2).
  STREAK_STEP_PCT: RULESET_V1.streakStepPct,
  BREAK_PCT_PER_LENGTH: RULESET_V1.breakPctPerLen,
  BREAK_LENGTH_CAP: RULESET_V1.breakLenCap,
  BREAK_MAX_PCT: RULESET_V1.breakPctPerLen * RULESET_V1.breakLenCap,
  UNDO_WINDOW_MIN: RULESET_V1.undoWindowMin,
  CHALLENGE_WINDOW_H: RULESET_V1.challengeWindowH,
  MAX_BACKDATE_H: RULESET_V1.maxBackdateH,
  // Points changes (SPEC §4.4).
  WEIGHT_VETO_LEAD_H: FREQUENCY_V1.vetoLeadHours,
  SUGGESTED_POINTS_MIN: FREQUENCY_V1.minPoints,
  SUGGESTED_POINTS_MAX: FREQUENCY_V1.maxPoints,
  // Bounties (SPEC §3.2).
  NEW_BOUNTY_DAYS: NEW_BOUNTY_MS / DAY_MS,
  PHOTO_RETENTION_DAYS: PHOTO_DAYS,
  // The kitchen iPad (SPEC §8).
  KIOSK_PAIRING_CODE_MIN: KIOSK_PAIRING_TTL_MS / MINUTE_MS,
  KIOSK_PIN_MIN_DIGITS,
  KIOSK_PIN_MAX_DIGITS,
  KIOSK_IDLE_SECONDS: KIOSK_IDLE_MS / 1000,
  SCREENSAVER_IDLE_MIN: SCREENSAVER_IDLE_MS / MINUTE_MS,
  NIGHT_START: clockTime(DEFAULT_NIGHT_WINDOW.startMin),
  NIGHT_END: clockTime(DEFAULT_NIGHT_WINDOW.endMin),
  KIOSK_CLIP_MAX_SECONDS: MAX_RECORDING_MS / 1000,
  // Telegram (SPEC §6.6).
  TELEGRAM_BOT: `@${DEFAULT_TELEGRAM_BOT_USERNAME}`,
  TELEGRAM_LINK_CODE_MIN: TELEGRAM_LINK_CODE_TTL_MS / MINUTE_MS,
};
