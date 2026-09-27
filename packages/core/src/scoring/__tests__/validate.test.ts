import { describe, expect, it } from "vitest";
import { NoRuleVersionError, RULESET_V1 } from "../ruleset";
import {
  isLive,
  validateNewCompletion,
  type NewCompletion,
  type ValidatorCompletion,
} from "../validate";
import { DAY, DISHES, HOUR, TRASH, berlin, completion } from "./fixtures";

const MINUTE = 60_000;

function row(
  occurredAt: Date,
  overrides: Partial<ValidatorCompletion> = {},
): ValidatorCompletion {
  const { id, loggedAt, status, confirmMode } = completion("x", occurredAt);
  return { id, occurredAt, loggedAt, status, confirmMode, ...overrides };
}

function attempt(overrides: Partial<NewCompletion>): NewCompletion {
  const now = overrides.now ?? berlin(2026, 9, 21, 12);
  return {
    now,
    occurredAt: now,
    chore: { archivedAt: null, proofMode: "none" },
    hasPhoto: false,
    seasonStatus: "active",
    ruleVersions: [TRASH],
    completions: [],
    ...overrides,
  };
}

describe("SPEC §4.6 worked examples", () => {
  // Monday 21 Sep 2026.
  const mon0800 = berlin(2026, 9, 21, 8);
  const wed0800 = berlin(2026, 9, 23, 8);

  it("E5: trash again Mon 20:00 or by the partner Tue 09:00 hits COOLDOWN until Wed 08:00", () => {
    for (const at of [berlin(2026, 9, 21, 20), berlin(2026, 9, 22, 9)]) {
      expect(
        validateNewCompletion(
          attempt({ now: at, occurredAt: at, completions: [row(mon0800)] }),
        ),
      ).toEqual({ ok: false, code: "COOLDOWN", retryAt: wed0800 });
    }
  });

  it("E11: a disputed trash claim is live, so the partner hits COOLDOWN", () => {
    const at = berlin(2026, 9, 21, 10);
    expect(
      validateNewCompletion(
        attempt({
          now: at,
          occurredAt: at,
          completions: [row(mon0800, { status: "disputed" })],
        }),
      ),
    ).toEqual({ ok: false, code: "COOLDOWN", retryAt: wed0800 });
  });

  it("E12: dishes cool down across the season boundary", () => {
    const dec31 = berlin(2026, 12, 31, 23, 50);
    const jan1 = berlin(2027, 1, 1, 0, 5);
    expect(
      validateNewCompletion(
        attempt({
          now: jan1,
          occurredAt: jan1,
          ruleVersions: [DISHES],
          // The previous season's last live completion.
          completions: [row(dec31)],
        }),
      ),
    ).toEqual({
      ok: false,
      code: "COOLDOWN",
      retryAt: new Date(dec31.getTime() + DISHES.cooldownMinutes * MINUTE),
    });
  });
});

describe("validateNewCompletion", () => {
  const last = berlin(2026, 9, 21, 8);
  const boundary = new Date(last.getTime() + TRASH.cooldownMinutes * MINUTE);

  it("accepts the first completion of a chore", () => {
    expect(validateNewCompletion(attempt({}))).toEqual({ ok: true });
  });

  it("allows a completion exactly at the cooldown boundary", () => {
    expect(
      validateNewCompletion(
        attempt({
          now: boundary,
          occurredAt: boundary,
          completions: [row(last)],
        }),
      ),
    ).toEqual({ ok: true });
    const early = new Date(boundary.getTime() - 1);
    expect(
      validateNewCompletion(
        attempt({ now: early, occurredAt: early, completions: [row(last)] }),
      ),
    ).toEqual({ ok: false, code: "COOLDOWN", retryAt: boundary });
  });

  it("measures the cooldown from the latest live completion", () => {
    const later = new Date(last.getTime() + 3 * DAY);
    const at = new Date(later.getTime() + HOUR);
    expect(
      validateNewCompletion(
        attempt({
          now: at,
          occurredAt: at,
          completions: [row(later), row(last)],
        }),
      ),
    ).toMatchObject({
      code: "COOLDOWN",
      retryAt: new Date(later.getTime() + TRASH.cooldownMinutes * MINUTE),
    });
  });

  it("uses the cooldown of the rule version in effect at occurred_at", () => {
    const shorter = {
      id: "trash-v2",
      effectiveFrom: berlin(2026, 9, 1),
      basePoints: TRASH.basePoints,
      cooldownMinutes: 60,
    };
    const at = new Date(last.getTime() + 2 * HOUR);
    expect(
      validateNewCompletion(
        attempt({
          now: at,
          occurredAt: at,
          ruleVersions: [TRASH, shorter],
          completions: [row(last)],
        }),
      ),
    ).toEqual({ ok: true });
    expect(() =>
      validateNewCompletion(
        attempt({
          now: at,
          occurredAt: at,
          ruleVersions: [],
          completions: [row(last)],
        }),
      ),
    ).toThrow(NoRuleVersionError);
  });

  it("ignores voided and expired partner-pending rows", () => {
    const at = new Date(last.getTime() + 4 * DAY);
    const expiredLoggedAt = new Date(
      at.getTime() - RULESET_V1.partnerConfirmExpiryH * HOUR,
    );
    expect(
      validateNewCompletion(
        attempt({
          now: at,
          occurredAt: at,
          completions: [
            row(last),
            row(new Date(at.getTime() - HOUR), { status: "voided" }),
            row(expiredLoggedAt, {
              status: "pending",
              confirmMode: "partner",
              loggedAt: expiredLoggedAt,
            }),
          ],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("OUT_OF_ORDER: rejects a completion before the last live one", () => {
    const now = new Date(last.getTime() + 12 * HOUR);
    expect(
      validateNewCompletion(
        attempt({
          now,
          occurredAt: new Date(last.getTime() - HOUR),
          completions: [row(last)],
        }),
      ),
    ).toEqual({ ok: false, code: "OUT_OF_ORDER" });
  });

  it("FUTURE: allows 2 minutes of skew, not more", () => {
    const now = berlin(2026, 9, 21, 12);
    const skew = RULESET_V1.maxFutureMin * MINUTE;
    expect(
      validateNewCompletion(
        attempt({ now, occurredAt: new Date(now.getTime() + skew) }),
      ),
    ).toEqual({ ok: true });
    expect(
      validateNewCompletion(
        attempt({ now, occurredAt: new Date(now.getTime() + skew + 1) }),
      ),
    ).toEqual({ ok: false, code: "FUTURE" });
  });

  it("BACKDATE_TOO_FAR: allows 24h back, not more", () => {
    const now = berlin(2026, 9, 21, 12);
    const max = RULESET_V1.maxBackdateH * HOUR;
    expect(
      validateNewCompletion(
        attempt({ now, occurredAt: new Date(now.getTime() - max) }),
      ),
    ).toEqual({ ok: true });
    expect(
      validateNewCompletion(
        attempt({ now, occurredAt: new Date(now.getTime() - max - 1) }),
      ),
    ).toEqual({ ok: false, code: "BACKDATE_TOO_FAR" });
  });

  it("SEASON_CLOSED: rejects a closed season but allows a closing one", () => {
    expect(validateNewCompletion(attempt({ seasonStatus: "closed" }))).toEqual({
      ok: false,
      code: "SEASON_CLOSED",
    });
    expect(validateNewCompletion(attempt({ seasonStatus: "closing" }))).toEqual(
      {
        ok: true,
      },
    );
  });

  it("PHOTO_REQUIRED: a required-proof chore needs a photo", () => {
    const chore = { archivedAt: null, proofMode: "required" as const };
    expect(validateNewCompletion(attempt({ chore }))).toEqual({
      ok: false,
      code: "PHOTO_REQUIRED",
    });
    expect(validateNewCompletion(attempt({ chore, hasPhoto: true }))).toEqual({
      ok: true,
    });
    expect(
      validateNewCompletion(
        attempt({ chore: { archivedAt: null, proofMode: "optional" } }),
      ),
    ).toEqual({ ok: true });
  });

  it("ARCHIVED_CHORE: an archived chore takes no completions", () => {
    expect(
      validateNewCompletion(
        attempt({
          chore: { archivedAt: berlin(2026, 1, 1), proofMode: "none" },
        }),
      ),
    ).toEqual({ ok: false, code: "ARCHIVED_CHORE" });
  });
});

describe("isLive", () => {
  const loggedAt = berlin(2026, 9, 21, 8);
  const expiry = new Date(
    loggedAt.getTime() + RULESET_V1.partnerConfirmExpiryH * HOUR,
  );

  it("keeps partner-pending rows live until 72h after logging", () => {
    const c = row(loggedAt, { status: "pending", confirmMode: "partner" });
    expect(isLive(c, new Date(expiry.getTime() - 1))).toBe(true);
    expect(isLive(c, expiry)).toBe(false);
  });

  it("treats every non-voided status otherwise as live", () => {
    for (const status of [
      "pending",
      "confirmed",
      "finalized",
      "disputed",
    ] as const) {
      expect(isLive(row(loggedAt, { status }), expiry)).toBe(true);
    }
    expect(isLive(row(loggedAt, { status: "voided" }), loggedAt)).toBe(false);
  });
});
