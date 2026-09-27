import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seasonBounds } from "../../time";
import {
  PHOTO_RETENTION_DAYS,
  photoPruneAt,
  seasonClosableAt,
  seasonStatusAt,
  verificationEndedAt,
} from "../lifecycle";
import { RULESET_V1 } from "../ruleset";
import {
  initialVerification,
  transition,
  type VerificationRow,
} from "../verification";
import { DAY, HOUR, PARTNER, RYAN, berlin } from "./fixtures";

const ADMIN = "member-admin";
const WINDOW = RULESET_V1.challengeWindowH * HOUR;
const EXPIRY = RULESET_V1.partnerConfirmExpiryH * HOUR;
const BACKDATE = RULESET_V1.maxBackdateH * HOUR;
const RETAIN = PHOTO_RETENTION_DAYS * DAY;

describe("seasonStatusAt", () => {
  const { endsAt } = seasonBounds(2026);
  const closable = seasonClosableAt(endsAt);
  const at = (ms: number) => new Date(endsAt.getTime() + ms);

  it("closes at Dec 31 24:00 Berlin, plus the backdate allowance", () => {
    expect(endsAt).toEqual(berlin(2027, 1, 1));
    expect(closable.getTime() - endsAt.getTime()).toBe(BACKDATE);
  });

  it("is active until Dec 31 24:00 Berlin", () => {
    const s = { status: "active" as const, endsAt, hasOpenClaims: false };
    expect(seasonStatusAt(s, at(-1))).toBe("active");
    expect(seasonStatusAt(s, at(0))).toBe("closing");
  });

  it("stays closing while a completion may still be backdated into it", () => {
    const s = { status: "active" as const, endsAt, hasOpenClaims: false };
    expect(seasonStatusAt(s, at(BACKDATE - 1))).toBe("closing");
    expect(seasonStatusAt(s, at(BACKDATE))).toBe("closed");
  });

  it("stays closing while any claim is still open", () => {
    const s = { status: "closing" as const, endsAt, hasOpenClaims: true };
    expect(seasonStatusAt(s, at(10 * DAY))).toBe("closing");
    expect(seasonStatusAt({ ...s, hasOpenClaims: false }, at(10 * DAY))).toBe(
      "closed",
    );
  });

  it("keeps a stored closed season closed", () => {
    const s = { status: "closed" as const, endsAt, hasOpenClaims: true };
    expect(seasonStatusAt(s, at(-DAY))).toBe("closed");
  });

  it("never goes back once closed (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -30 * DAY, max: 30 * DAY }),
        fc.integer({ min: 0, max: 30 * DAY }),
        fc.boolean(),
        (t, later, open) => {
          const s = { status: "active" as const, endsAt, hasOpenClaims: open };
          const first = seasonStatusAt(s, at(t));
          const second = seasonStatusAt(s, at(t + later));
          const order = ["active", "closing", "closed"];
          expect(order.indexOf(second)).toBeGreaterThanOrEqual(
            order.indexOf(first),
          );
        },
      ),
    );
  });
});

describe("verificationEndedAt and photoPruneAt", () => {
  const loggedAt = berlin(2026, 3, 2, 8);
  const at = (ms: number) => new Date(loggedAt.getTime() + ms);

  function claim(confirmMode: "optimistic" | "partner"): VerificationRow {
    return initialVerification({
      doneBy: RYAN,
      loggedBy: RYAN,
      confirmMode,
      loggedAt,
      photoAttachedAt: loggedAt,
    });
  }

  function after(
    row: VerificationRow,
    ...events: Parameters<typeof transition>[1][]
  ) {
    let r = row;
    for (const e of events) {
      const out = transition(r, e, at(HOUR));
      if (!out.ok) throw new Error(out.code);
      r = out.row;
    }
    return r;
  }

  it("is open while the claim is pending or disputed", () => {
    const row = claim("optimistic");
    expect(verificationEndedAt(row, at(WINDOW - 1), null)).toBeNull();
    expect(photoPruneAt(row, at(WINDOW - 1), null)).toBeNull();
    const disputed = after(row, {
      type: "dispute",
      actor: PARTNER,
      reason: "not done",
    });
    // A photo attached in time keeps a dispute open until someone rules.
    expect(verificationEndedAt(disputed, at(30 * DAY), null)).toBeNull();
  });

  it("ends an optimistic claim when its window does", () => {
    const row = claim("optimistic");
    expect(verificationEndedAt(row, at(WINDOW), null)).toEqual(at(WINDOW));
    expect(photoPruneAt(row, at(WINDOW), null)).toEqual(at(WINDOW + RETAIN));
  });

  it("ends an early confirmation no sooner than its window", () => {
    const row = after(claim("optimistic"), { type: "confirm", actor: PARTNER });
    expect(verificationEndedAt(row, at(HOUR), null)).toEqual(at(WINDOW));
  });

  it("ends a partner-mode claim at its expiry at the earliest", () => {
    const row = claim("partner");
    expect(verificationEndedAt(row, at(EXPIRY - 1), null)).toBeNull();
    expect(verificationEndedAt(row, at(EXPIRY), null)).toEqual(at(EXPIRY));
    const confirmed = after(row, { type: "confirm", actor: PARTNER });
    expect(verificationEndedAt(confirmed, at(HOUR), null)).toEqual(
      at(EXPIRY),
    );
  });

  it("ends a ruled dispute at the ruling, and a late confirmation then", () => {
    const disputed = after(claim("optimistic"), {
      type: "dispute",
      actor: PARTNER,
      reason: "not done",
    });
    const ruled = transition(
      disputed,
      {
        type: "resolve",
        actor: ADMIN,
        actorIsAdmin: true,
        outcome: "uphold",
      },
      at(10 * DAY),
    );
    if (!ruled.ok) throw new Error(ruled.code);
    expect(verificationEndedAt(ruled.row, at(10 * DAY), at(10 * DAY))).toEqual(
      at(10 * DAY),
    );
    expect(
      photoPruneAt(ruled.row, at(10 * DAY), at(9 * DAY)),
    ).toEqual(at(10 * DAY + RETAIN));
  });
});
