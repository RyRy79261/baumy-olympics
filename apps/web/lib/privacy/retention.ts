import { AUTH_SESSION, SECURITY_COOKIES } from "@baumy/auth/env";
import { PHOTO_RETENTION_DAYS } from "@baumy/core";
import { RATE_LIMIT_ROW_HORIZON_MS } from "@baumy/db/rate-limit";

// How long things are kept, in the units the privacy page states them
// (app/privacy/page.tsx, "How long we keep it"). The page and `get_my_data`
// (issue #144) both read these, and these read the constants the code runs
// on, so what Baumy tells a member and what the policy says cannot drift.

const DAY_S = 24 * 60 * 60;

/** A session ends this many days after its device last used the app. */
export const SESSION_DAYS = AUTH_SESSION.expiresInSeconds / DAY_S;
/** "Trust this device" skips the two-factor code for this many days. */
export const TRUST_DAYS = SECURITY_COOKIES.trustDeviceMaxAgeSeconds / DAY_S;
/** The app's own rate-limit counters go at the latest this long after use. */
export const RATE_LIMIT_DAYS = RATE_LIMIT_ROW_HORIZON_MS / (DAY_S * 1000);

/** The retention rules as `get_my_data` returns them. */
export interface RetentionRules {
  photoDays: number;
  sessionDays: number;
  trustedDeviceDays: number;
  rateLimitDays: number;
  /** The rules in plain sentences, in the privacy page's words. */
  rules: string[];
  /** Where the full policy is. */
  policyUrl: "/privacy";
}

export const RETENTION: RetentionRules = {
  photoDays: PHOTO_RETENTION_DAYS,
  sessionDays: SESSION_DAYS,
  trustedDeviceDays: TRUST_DAYS,
  rateLimitDays: RATE_LIMIT_DAYS,
  rules: [
    `Proof photos are deleted ${PHOTO_RETENTION_DAYS} days after their claim was settled.`,
    `Sessions end when you sign out, or ${SESSION_DAYS} days after you last used the app on that device.`,
    `A trusted device skips the two-factor code for ${TRUST_DAYS} days.`,
    "Everything else stays while the household uses the app and is not deleted automatically, including the audit log. A deleted note is hidden everywhere but stays in the database.",
  ],
  policyUrl: "/privacy",
};
