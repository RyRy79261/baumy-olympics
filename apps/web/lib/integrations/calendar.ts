import "server-only";

import { isTestMode } from "@/lib/test-mode";
import { memoryCalendar } from "./calendar-memory";
import {
  calendarConfig,
  googleCalendar,
  type CalendarClient,
  type EnvBag,
} from "./google-calendar";

// Which calendar this environment talks to (SPEC §6.4, §10): the in-memory
// fake under E2E_TEST_MODE=1, Google when all three GOOGLE_CALENDAR_* are
// set, and otherwise one that answers `not_configured` to everything, so the
// page says the calendar is not connected rather than failing.

const NOT_CONFIGURED = { ok: false, reason: "not_configured" } as const;

export const unconfiguredCalendar: CalendarClient = {
  list: async () => NOT_CONFIGURED,
  get: async () => NOT_CONFIGURED,
  create: async () => NOT_CONFIGURED,
  update: async () => NOT_CONFIGURED,
  delete: async () => NOT_CONFIGURED,
  restore: async () => NOT_CONFIGURED,
};

let override: CalendarClient | null = null;

/** Unit tests only: answer with this client until reset with null. */
export function setCalendarClientForTests(client: CalendarClient | null): void {
  override = client;
}

export function calendarClient(env: EnvBag = process.env): CalendarClient {
  if (override) return override;
  if (isTestMode(env)) return memoryCalendar();
  const config = calendarConfig(env);
  return config ? googleCalendar(config, { env }) : unconfiguredCalendar;
}
