// SPEC §4.5, §6.7: what time does to a season and to a proof photo. Pure: the
// caller passes `now` and what the database knows. The daily job persists
// these; reads derive them, so correctness never waits on the job.
import { RULESET_V1, type Ruleset } from "./ruleset";
import type { SeasonStatus } from "./validate";
import {
  challengeWindowEndsAt,
  effectiveStatus,
  partnerExpiresAt,
  type VerificationRow,
} from "./verification";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A proof photo is deleted this long after its claim settled (SPEC §6.5). */
export const PHOTO_RETENTION_DAYS = 90;

/**
 * The first moment a season may close: its end plus the backdate allowance,
 * since until then a completion may still be logged into it.
 */
export function seasonClosableAt(
  endsAt: Date,
  ruleset: Ruleset = RULESET_V1,
): Date {
  return new Date(endsAt.getTime() + ruleset.maxBackdateH * HOUR);
}

export interface SeasonAt {
  /** `seasons.status` as stored. */
  status: SeasonStatus;
  endsAt: Date;
  /**
   * Whether any of the season's completions is still `pending` or `disputed`
   * by `effectiveStatus` at `now`: a challenge window (or a partner's 72h, or
   * an admin's ruling on a disputed claim with an in-time photo) is still
   * open, so the standings may still move.
   */
  hasOpenClaims: boolean;
}

/**
 * The season's status at `now` (SPEC §4.5): `active` until Dec 31 24:00
 * Berlin (`endsAt`), then `closing`, then `closed` once no completion can be
 * logged into it any more and none of its claims is still open. A stored
 * `closed` is final.
 */
export function seasonStatusAt(
  season: SeasonAt,
  now: Date,
  ruleset: Ruleset = RULESET_V1,
): SeasonStatus {
  if (season.status === "closed") return "closed";
  const t = now.getTime();
  if (t < season.endsAt.getTime()) return season.status;
  if (t < seasonClosableAt(season.endsAt, ruleset).getTime()) return "closing";
  return season.hasOpenClaims ? "closing" : "closed";
}

/**
 * When the claim's verification ended, or null while it is still open at
 * `now`. The latest of the moments that can end it: the challenge window, a
 * confirmation, a partner-mode expiry and the last dispute ruling. Later is
 * the safe side: a photo is never pruned before its claim has settled.
 */
export function verificationEndedAt(
  row: VerificationRow,
  now: Date,
  lastDisputeResolvedAt: Date | null,
  ruleset: Ruleset = RULESET_V1,
): Date | null {
  const status = effectiveStatus(row, now, ruleset);
  if (status === "pending" || status === "disputed") return null;
  const moments = [challengeWindowEndsAt(row, ruleset).getTime()];
  if (row.verifiedAt) moments.push(row.verifiedAt.getTime());
  if (lastDisputeResolvedAt) moments.push(lastDisputeResolvedAt.getTime());
  if (row.confirmMode === "partner") {
    moments.push(partnerExpiresAt(row, ruleset).getTime());
  }
  return new Date(Math.max(...moments));
}

/**
 * When a claim's proof photo is due for deletion: `PHOTO_RETENTION_DAYS`
 * after its verification ended, or null while the claim is still open.
 */
export function photoPruneAt(
  row: VerificationRow,
  now: Date,
  lastDisputeResolvedAt: Date | null,
  ruleset: Ruleset = RULESET_V1,
): Date | null {
  const ended = verificationEndedAt(row, now, lastDisputeResolvedAt, ruleset);
  return ended ? new Date(ended.getTime() + PHOTO_RETENTION_DAYS * DAY) : null;
}
