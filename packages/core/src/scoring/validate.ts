// SPEC §4.2 "Write validator": may this completion be stored? Checked against
// the chore's *live* completions, so a dispute cannot open a cooldown gap that
// reinstating the claim would later close.
import {
  RULESET_V1,
  ruleVersionAt,
  type CompletionStatus,
  type ConfirmMode,
  type RuleVersion,
  type Ruleset,
} from "./ruleset";

export type ProofMode = "none" | "optional" | "required";
export type SeasonStatus = "active" | "closing" | "closed";

export type ValidationErrorCode =
  | "COOLDOWN"
  | "FUTURE"
  | "BACKDATE_TOO_FAR"
  | "OUT_OF_ORDER"
  | "SEASON_CLOSED"
  | "PHOTO_REQUIRED"
  | "ARCHIVED_CHORE";

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: "COOLDOWN"; retryAt: Date }
  | { ok: false; code: Exclude<ValidationErrorCode, "COOLDOWN"> };

export interface ValidatorCompletion {
  id: string;
  occurredAt: Date;
  loggedAt: Date;
  status: CompletionStatus;
  confirmMode: ConfirmMode;
}

export interface NewCompletion {
  /** The caller's clock (`lib/clock.ts`); nothing here reads the time. */
  now: Date;
  occurredAt: Date;
  chore: { archivedAt: Date | null; proofMode: ProofMode };
  hasPhoto: boolean;
  /** The status of the season `occurredAt` falls in. */
  seasonStatus: SeasonStatus;
  ruleVersions: readonly RuleVersion[];
  /**
   * The chore's completions from the start of the season `occurredAt` falls
   * in onward (including any already in the next season, which a backdated
   * completion into a `closing` season must not slip in before), plus the
   * previous live one from before it, so `COOLDOWN` reaches across the season
   * boundary (E12). Non-live rows may be included; they are ignored.
   */
  completions: readonly ValidatorCompletion[];
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Live (SPEC §4.1): not voided at `now`. That includes disputed rows and
 * partner-mode pending rows that have not yet expired unconfirmed. A disputed
 * row whose challenge window has run out without a photo is voided only once
 * `verification.ts` (issue #12) or the daily job has persisted it.
 */
export function isLive(
  c: ValidatorCompletion,
  now: Date,
  ruleset: Ruleset = RULESET_V1,
): boolean {
  if (c.status === "voided") return false;
  if (c.status === "pending" && c.confirmMode === "partner") {
    const expiresAt =
      c.loggedAt.getTime() + ruleset.partnerConfirmExpiryH * HOUR;
    return now.getTime() < expiresAt;
  }
  return true;
}

export function validateNewCompletion(
  input: NewCompletion,
  ruleset: Ruleset = RULESET_V1,
): ValidationResult {
  const now = input.now.getTime();
  const at = input.occurredAt.getTime();

  if (input.chore.archivedAt !== null) {
    return { ok: false, code: "ARCHIVED_CHORE" };
  }
  if (input.seasonStatus === "closed") {
    return { ok: false, code: "SEASON_CLOSED" };
  }
  if (at > now + ruleset.maxFutureMin * MINUTE) {
    return { ok: false, code: "FUTURE" };
  }
  if (at < now - ruleset.maxBackdateH * HOUR) {
    return { ok: false, code: "BACKDATE_TOO_FAR" };
  }
  if (input.chore.proofMode === "required" && !input.hasPhoto) {
    return { ok: false, code: "PHOTO_REQUIRED" };
  }

  let last: number | null = null;
  for (const c of input.completions) {
    if (!isLive(c, input.now, ruleset)) continue;
    const t = c.occurredAt.getTime();
    if (last === null || t > last) last = t;
  }
  if (last === null) return { ok: true };

  // History is append-only: nothing may be slotted in before the last one.
  if (at < last) return { ok: false, code: "OUT_OF_ORDER" };

  const { cooldownMinutes } = ruleVersionAt(
    input.ruleVersions,
    input.occurredAt,
  );
  const retryAt = last + cooldownMinutes * MINUTE;
  // Landing exactly on the boundary is allowed.
  if (at < retryAt) {
    return { ok: false, code: "COOLDOWN", retryAt: new Date(retryAt) };
  }
  return { ok: true };
}
