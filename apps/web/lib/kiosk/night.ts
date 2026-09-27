import { berlinParts } from "@baumy/core";
import { isTestMode } from "@/lib/test-mode";

// Night mode's schedule (SPEC §8, issue #29): from 23:00 to 06:30 Berlin
// time the kitchen screen dims to a sleeping Baumy and a clock. Pure and
// client-safe: the kiosk shell reads the window from `KIOSK_NIGHT_HOURS` on
// the server and hands it to the client, which asks `isNightAt` every second
// with the server's time. Berlin wall time, whatever zone the iPad or the
// server is in, and whatever daylight saving is doing that night.

/** Minutes after Berlin midnight: 23:00 is 1380. */
export interface NightWindow {
  startMin: number;
  endMin: number;
}

/** SPEC §8: 23:00 to 06:30. */
export const DEFAULT_NIGHT_WINDOW: NightWindow = {
  startMin: 23 * 60,
  endMin: 6 * 60 + 30,
};

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(hhmm: string): number | null {
  const m = HH_MM.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * `"23:00-06:30"` as a window; `"off"` turns night mode off (null). Anything
 * else, or a window that starts and ends at the same minute, is `undefined`:
 * not a setting.
 */
export function parseNightWindow(
  value: string,
): NightWindow | null | undefined {
  const text = value.trim().toLowerCase();
  if (text === "off") return null;
  const [from, to, ...rest] = text.split("-");
  if (from === undefined || to === undefined || rest.length > 0) {
    return undefined;
  }
  const startMin = minutes(from);
  const endMin = minutes(to);
  if (startMin === null || endMin === null || startMin === endMin) {
    return undefined;
  }
  return { startMin, endMin };
}

/**
 * The kiosk's window from `KIOSK_NIGHT_HOURS`: unset means the default, and
 * a value that does not parse falls back to the default too (with a warning),
 * so a typo never keeps the kitchen screen awake all night or asleep all day.
 */
export function nightWindowFromEnv(
  env: Record<string, string | undefined> = process.env,
): NightWindow | null {
  const raw = env.KIOSK_NIGHT_HOURS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_NIGHT_WINDOW;
  const parsed = parseNightWindow(raw);
  if (parsed !== undefined) return parsed;
  console.warn(
    'KIOSK_NIGHT_HOURS is not "HH:MM-HH:MM" or "off"; using 23:00-06:30.',
  );
  return DEFAULT_NIGHT_WINDOW;
}

/**
 * The cookie an e2e spec sets (`baumy_e2e_night=23:00-06:30`) to give its
 * own browser a night window.
 */
export const NIGHT_TEST_COOKIE = "baumy_e2e_night";

/**
 * The kiosk's night window for one request. Under E2E_TEST_MODE=1 night
 * mode is OFF unless that browser's `baumy_e2e_night` cookie sets a window,
 * so kiosk specs running in parallel never meet a night screen, whatever
 * the real time is and wherever another spec moved the shared server clock.
 * Everywhere else it is `KIOSK_NIGHT_HOURS`.
 */
export function kioskNightWindow(
  testCookie: string | undefined,
  env: Record<string, string | undefined> = process.env,
): NightWindow | null {
  if (isTestMode(env)) {
    return testCookie ? (parseNightWindow(testCookie) ?? null) : null;
  }
  return nightWindowFromEnv(env);
}

/** True when Berlin's clock at `instant` reads inside the window. */
export function isNightAt(instant: Date, window: NightWindow | null): boolean {
  if (!window) return false;
  const p = berlinParts(instant);
  const m = p.hour * 60 + p.minute;
  const { startMin, endMin } = window;
  // A window that crosses midnight (23:00-06:30) is two pieces.
  return startMin < endMin
    ? m >= startMin && m < endMin
    : m >= startMin || m < endMin;
}

/** "23:00-06:30", for the docs and the night screen. */
export function formatNightWindow(window: NightWindow): string {
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  return `${hhmm(window.startMin)}-${hhmm(window.endMin)}`;
}

/**
 * The DOM event the night screen sends when it sleeps or wakes, so Baumy's
 * sprite follows (lib/ai/mood.ts `sleep`/`wake`). `detail.asleep`.
 */
export const NIGHT_EVENT = "baumy:night";

export type NightEventDetail = { asleep: boolean };
