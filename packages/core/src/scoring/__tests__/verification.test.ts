import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { replayChore, type ReplayCompletion } from "../replay";
import { RULESET_V1 } from "../ruleset";
import {
  attachPhoto,
  challengeWindowEndsAt,
  effectiveStatus,
  initialVerification,
  isVerified,
  partnerExpiresAt,
  settle,
  transition,
  type VerificationEvent,
  type VerificationRow,
} from "../verification";
import { BATHROOM, DAY, HOUR, PARTNER, RYAN, berlin } from "./fixtures";

const MINUTE = 60_000;
const ADMIN = "member-admin";
const WINDOW = RULESET_V1.challengeWindowH * HOUR;
const GRACE = RULESET_V1.withdrawGraceH * HOUR;
const UNDO = RULESET_V1.undoWindowMin * MINUTE;
const EXPIRY = RULESET_V1.partnerConfirmExpiryH * HOUR;

const loggedAt = berlin(2026, 9, 21, 8);
const at = (ms: number) => new Date(loggedAt.getTime() + ms);

function selfClaim(
  confirmMode: "optimistic" | "partner" = "optimistic",
  photoAttachedAt: Date | null = null,
): VerificationRow {
  return initialVerification({
    doneBy: RYAN,
    loggedBy: RYAN,
    confirmMode,
    loggedAt,
    photoAttachedAt,
  });
}

/** Apply an event that must succeed, and return the new row. */
function apply(
  row: VerificationRow,
  event: VerificationEvent,
  now: Date,
): VerificationRow {
  const r = transition(row, event, now);
  if (!r.ok) throw new Error(`${event.type} failed with ${r.code}`);
  expect(r.expectedStatus).toBe(row.status);
  return r.row;
}

const dispute = (actor = PARTNER): VerificationEvent => ({
  type: "dispute",
  actor,
  reason: "the bin is still full",
});

function disputed(
  confirmMode: "optimistic" | "partner" = "optimistic",
  when = at(HOUR),
): VerificationRow {
  return apply(selfClaim(confirmMode), dispute(), when);
}

describe("initialVerification", () => {
  it("verifies a completion logged for someone else on creation", () => {
    const row = initialVerification({
      doneBy: RYAN,
      loggedBy: PARTNER,
      confirmMode: "partner",
      loggedAt,
    });
    expect(row).toMatchObject({
      status: "confirmed",
      finalizesAt: null,
      verifiedBy: PARTNER,
      verifiedAt: loggedAt,
      photoAttachedAt: null,
    });
    expect(isVerified(row)).toBe(true);
  });

  it("starts an optimistic self-claim as pending until logged_at + 24h", () => {
    const row = selfClaim("optimistic", loggedAt);
    expect(row).toMatchObject({
      status: "pending",
      finalizesAt: at(WINDOW),
      verifiedBy: null,
      photoAttachedAt: loggedAt,
    });
    expect(isVerified(row)).toBe(false);
  });

  it("starts a partner self-claim as pending with no finalizes_at", () => {
    const row = selfClaim("partner");
    expect(row).toMatchObject({ status: "pending", finalizesAt: null });
    expect(partnerExpiresAt(row)).toEqual(at(EXPIRY));
    expect(challengeWindowEndsAt(row)).toEqual(at(WINDOW));
  });
});

describe("SPEC §4.3 transition table", () => {
  it("pending → confirmed when another member confirms (either mode)", () => {
    for (const mode of ["optimistic", "partner"] as const) {
      const row = apply(
        selfClaim(mode),
        { type: "confirm", actor: PARTNER },
        at(HOUR),
      );
      expect(row).toMatchObject({
        status: "confirmed",
        verifiedBy: PARTNER,
        verifiedAt: at(HOUR),
      });
      expect(isVerified(row)).toBe(true);
    }
  });

  it("pending: the doer cannot confirm their own claim", () => {
    expect(
      transition(selfClaim(), { type: "confirm", actor: RYAN }, at(HOUR)),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("⏱ pending (optimistic) → finalized once finalizes_at <= now", () => {
    const row = selfClaim();
    expect(effectiveStatus(row, at(WINDOW - 1))).toBe("pending");
    expect(effectiveStatus(row, at(WINDOW))).toBe("finalized");
    expect(settle(row, at(WINDOW))).toEqual({ ...row, status: "finalized" });
    // Too late to confirm: time already moved it on.
    expect(
      transition(row, { type: "confirm", actor: PARTNER }, at(WINDOW)),
    ).toEqual({ ok: false, code: "INVALID_STATE" });
  });

  it("⏱ pending (partner) → voided (unconfirmed) after 72h", () => {
    const row = selfClaim("partner");
    expect(effectiveStatus(row, at(EXPIRY - 1))).toBe("pending");
    expect(effectiveStatus(row, at(EXPIRY))).toBe("voided");
    expect(settle(row, at(EXPIRY))).toMatchObject({
      status: "voided",
      voidReason: "unconfirmed",
    });
    expect(
      transition(row, { type: "confirm", actor: PARTNER }, at(EXPIRY)),
    ).toEqual({ ok: false, code: "INVALID_STATE" });
  });

  it("pending → disputed when another member disputes inside the window", () => {
    const row = apply(selfClaim(), dispute(), at(WINDOW - 1));
    expect(row).toMatchObject({ status: "disputed", disputedBy: PARTNER });
  });

  it("pending: a dispute outside the window, by the doer, or with no reason fails", () => {
    // Optimistic: at the window's end the claim has already finalized.
    expect(transition(selfClaim(), dispute(), at(WINDOW))).toEqual({
      ok: false,
      code: "INVALID_STATE",
    });
    // Partner: still pending at 30h, but the challenge window is over.
    const partner = selfClaim("partner");
    expect(effectiveStatus(partner, at(30 * HOUR))).toBe("pending");
    expect(transition(partner, dispute(), at(30 * HOUR))).toEqual({
      ok: false,
      code: "WINDOW_CLOSED",
    });
    expect(transition(selfClaim(), dispute(RYAN), at(HOUR))).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      transition(
        selfClaim(),
        { type: "dispute", actor: PARTNER, reason: "   " },
        at(HOUR),
      ),
    ).toEqual({ ok: false, code: "REASON_REQUIRED" });
  });

  it("disputed → pending when the disputer withdraws; finalizes_at keeps the original if later", () => {
    const r = transition(
      disputed(),
      { type: "withdraw", actor: PARTNER },
      at(2 * HOUR),
    );
    expect(r).toMatchObject({
      ok: true,
      expectedStatus: "disputed",
      disputeResolution: "withdrawn",
      row: { status: "pending", disputedBy: null, finalizesAt: at(WINDOW) },
    });
  });

  it("disputed → pending on withdraw; finalizes_at moves to now + 1h near the window's end", () => {
    const withdrawAt = at(WINDOW - 10 * MINUTE);
    const row = apply(
      disputed(),
      { type: "withdraw", actor: PARTNER },
      withdrawAt,
    );
    expect(row.finalizesAt).toEqual(new Date(withdrawAt.getTime() + GRACE));
    // The extended window still takes a fresh dispute.
    expect(apply(row, dispute(), at(WINDOW + 10 * MINUTE)).status).toBe(
      "disputed",
    );
  });

  it("disputed → pending on withdraw keeps a partner claim without finalizes_at", () => {
    const row = apply(
      disputed("partner"),
      { type: "withdraw", actor: PARTNER },
      at(2 * HOUR),
    );
    expect(row).toMatchObject({ status: "pending", finalizesAt: null });
  });

  it("disputed: only the disputer can withdraw", () => {
    expect(
      transition(disputed(), { type: "withdraw", actor: RYAN }, at(2 * HOUR)),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("disputed → voided (conceded) when the doer concedes", () => {
    const r = transition(
      disputed(),
      { type: "concede", actor: RYAN },
      at(2 * HOUR),
    );
    expect(r).toMatchObject({
      ok: true,
      disputeResolution: "conceded",
      row: { status: "voided", voidReason: "conceded", disputedBy: null },
    });
    expect(
      transition(disputed(), { type: "concede", actor: PARTNER }, at(2 * HOUR)),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("⏱ disputed with no photo → voided (disputed) when the window ends", () => {
    const row = disputed();
    expect(effectiveStatus(row, at(WINDOW - 1))).toBe("disputed");
    expect(effectiveStatus(row, at(WINDOW))).toBe("voided");
    expect(settle(row, at(WINDOW))).toMatchObject({
      status: "voided",
      voidReason: "disputed",
      disputedBy: null,
    });
    // Nothing can reinstate it once timed out.
    expect(
      transition(row, { type: "withdraw", actor: PARTNER }, at(WINDOW)),
    ).toEqual({ ok: false, code: "INVALID_STATE" });
  });

  it("⏱ disputed with a photo attached before the window ends stays disputed", () => {
    const row = attachPhoto(disputed(), at(WINDOW - 1));
    const later = at(WINDOW + 5 * DAY);
    expect(effectiveStatus(row, later)).toBe("disputed");
    expect(settle(row, later)).toBe(row);
    // …until withdraw, concede or an admin ruling.
    expect(
      apply(row, { type: "withdraw", actor: PARTNER }, later),
    ).toMatchObject({
      status: "pending",
      finalizesAt: new Date(later.getTime() + GRACE),
    });
    expect(apply(row, { type: "concede", actor: RYAN }, later).status).toBe(
      "voided",
    );
    expect(
      apply(
        row,
        { type: "resolve", actor: ADMIN, actorIsAdmin: true, outcome: "void" },
        later,
      ).status,
    ).toBe("voided");
  });

  it("⏱ a photo attached after the window has no effect on the timeout", () => {
    for (const photoAt of [at(WINDOW), at(WINDOW + HOUR)]) {
      const row = attachPhoto(disputed(), photoAt);
      expect(row.photoAttachedAt).toEqual(photoAt);
      expect(effectiveStatus(row, photoAt)).toBe("voided");
      expect(settle(row, at(WINDOW + DAY))).toMatchObject({
        status: "voided",
        voidReason: "disputed",
      });
    }
  });

  it("a photo attached at logging counts as in time", () => {
    const row = apply(selfClaim("optimistic", loggedAt), dispute(), at(HOUR));
    expect(effectiveStatus(row, at(WINDOW + DAY))).toBe("disputed");
    // A later attach keeps the first time.
    expect(attachPhoto(row, at(WINDOW + DAY))).toBe(row);
  });

  it("pending/disputed → voided (undone) when the logger undoes within 10 min", () => {
    const pending = transition(
      selfClaim(),
      { type: "undo", actor: RYAN },
      at(UNDO),
    );
    expect(pending).toMatchObject({
      ok: true,
      disputeResolution: null,
      row: { status: "voided", voidReason: "undone" },
    });
    const fromDispute = transition(
      disputed("optimistic", at(MINUTE)),
      { type: "undo", actor: RYAN },
      at(5 * MINUTE),
    );
    expect(fromDispute).toMatchObject({
      ok: true,
      expectedStatus: "disputed",
      disputeResolution: "undone",
      row: { status: "voided", voidReason: "undone", disputedBy: null },
    });
  });

  it("undo: only the logger, and only within 10 min", () => {
    expect(
      transition(selfClaim(), { type: "undo", actor: RYAN }, at(UNDO + 1)),
    ).toEqual({ ok: false, code: "WINDOW_CLOSED" });
    expect(
      transition(selfClaim(), { type: "undo", actor: PARTNER }, at(MINUTE)),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("disputed → confirmed or voided by an admin ruling (resolve_dispute)", () => {
    const upheld = transition(
      disputed(),
      { type: "resolve", actor: ADMIN, actorIsAdmin: true, outcome: "uphold" },
      at(2 * HOUR),
    );
    expect(upheld).toMatchObject({
      ok: true,
      disputeResolution: "upheld",
      row: {
        status: "confirmed",
        disputedBy: null,
        verifiedBy: ADMIN,
        verifiedAt: at(2 * HOUR),
      },
    });
    const overruled = transition(
      disputed(),
      { type: "resolve", actor: ADMIN, actorIsAdmin: true, outcome: "void" },
      at(2 * HOUR),
    );
    expect(overruled).toMatchObject({
      ok: true,
      disputeResolution: "overruled",
      row: { status: "voided", voidReason: "disputed" },
    });
  });

  it("resolve: a non-admin, or an admin on their own claim, is forbidden", () => {
    expect(
      transition(
        disputed(),
        {
          type: "resolve",
          actor: PARTNER,
          actorIsAdmin: false,
          outcome: "void",
        },
        at(2 * HOUR),
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      transition(
        disputed(),
        { type: "resolve", actor: RYAN, actorIsAdmin: true, outcome: "uphold" },
        at(2 * HOUR),
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("returns INVALID_STATE for every event outside its from-states", () => {
    const confirmed = apply(
      selfClaim(),
      { type: "confirm", actor: PARTNER },
      at(HOUR),
    );
    const voided = apply(selfClaim(), { type: "undo", actor: RYAN }, at(1));
    const finalized = settle(selfClaim(), at(WINDOW));
    const events: VerificationEvent[] = [
      { type: "confirm", actor: PARTNER },
      dispute(),
      { type: "withdraw", actor: PARTNER },
      { type: "concede", actor: RYAN },
      { type: "undo", actor: RYAN },
      { type: "resolve", actor: ADMIN, actorIsAdmin: true, outcome: "void" },
    ];
    for (const row of [confirmed, voided, finalized]) {
      for (const e of events) {
        expect(transition(row, e, at(2 * HOUR))).toEqual({
          ok: false,
          code: "INVALID_STATE",
        });
      }
    }
    // Pending rows cannot be withdrawn, conceded or resolved.
    for (const e of events.slice(2, 4).concat(events[5]!)) {
      expect(transition(selfClaim(), e, at(HOUR))).toEqual({
        ok: false,
        code: "INVALID_STATE",
      });
    }
    // A disputed row cannot be confirmed or disputed again.
    for (const e of events.slice(0, 2)) {
      expect(transition(disputed(), e, at(2 * HOUR))).toEqual({
        ok: false,
        code: "INVALID_STATE",
      });
    }
  });

  it("settle leaves rows with nothing due untouched", () => {
    const confirmed = apply(
      selfClaim(),
      { type: "confirm", actor: PARTNER },
      at(HOUR),
    );
    expect(settle(confirmed, at(10 * DAY))).toBe(confirmed);
    expect(settle(selfClaim(), at(HOUR))).toEqual(selfClaim());
  });
});

describe("SPEC §4.6 worked example E9", () => {
  // A disputed Bathroom claim, then a photo, then the dispute is withdrawn.
  const doneAt = loggedAt;
  const earlier: ReplayCompletion = {
    id: "c-e9-0",
    doneBy: RYAN,
    occurredAt: new Date(doneAt.getTime() - 4 * DAY),
    loggedAt: new Date(doneAt.getTime() - 4 * DAY),
    status: "confirmed",
    confirmMode: "optimistic",
  };
  const asReplay = (row: VerificationRow): ReplayCompletion => ({
    id: "c-e9-1",
    doneBy: row.doneBy,
    occurredAt: doneAt,
    loggedAt: row.loggedAt,
    status: row.status,
    confirmMode: row.confirmMode,
  });
  const score = (row: VerificationRow) =>
    replayChore([earlier, asReplay(row)], [BATHROOM]).map((s) => [
      s.completionId,
      s.totalPts,
    ]);

  it.each([
    ["early", at(3 * HOUR), at(WINDOW)],
    ["late", at(WINDOW + 2 * DAY), at(WINDOW + 2 * DAY + GRACE)],
  ])(
    "withdrawn %s: excluded while disputed, then pending until max(logged_at + 24h, withdraw + 1h)",
    (_, withdrawAt, finalizesAt) => {
      const claim = selfClaim();
      const counted = score(claim);
      expect(counted).toEqual([
        ["c-e9-0", BATHROOM.basePoints],
        // Ryan's second Bathroom in a row: n = 2.
        ["c-e9-1", 33],
      ]);

      let row = apply(claim, dispute(), at(2 * HOUR));
      expect(score(row)).toEqual([["c-e9-0", BATHROOM.basePoints]]);

      row = attachPhoto(row, at(2 * HOUR + MINUTE));
      expect(effectiveStatus(row, withdrawAt)).toBe("disputed");
      expect(score(settle(row, withdrawAt))).toEqual([
        ["c-e9-0", BATHROOM.basePoints],
      ]);

      row = apply(row, { type: "withdraw", actor: PARTNER }, withdrawAt);
      expect(row).toMatchObject({ status: "pending", finalizesAt });
      // Re-scored: it counts again, provisionally.
      expect(score(row)).toEqual(counted);
      expect(effectiveStatus(row, new Date(finalizesAt.getTime() - 1))).toBe(
        "pending",
      );
      expect(effectiveStatus(row, finalizesAt)).toBe("finalized");
      expect(score(settle(row, finalizesAt))).toEqual(counted);
    },
  );
});

// ---- properties -----------------------------------------------------------

const MEMBERS = [RYAN, PARTNER, ADMIN] as const;
const START = berlin(2026, 3, 2, 8).getTime();
const SPAN = 5 * DAY;

const memberArb = fc.constantFrom(...MEMBERS);
const eventArb: fc.Arbitrary<VerificationEvent> = fc.oneof(
  fc.record({ type: fc.constant("confirm" as const), actor: memberArb }),
  fc.record({
    type: fc.constant("dispute" as const),
    actor: memberArb,
    reason: fc.constantFrom("", "not done"),
  }),
  fc.record({ type: fc.constant("withdraw" as const), actor: memberArb }),
  fc.record({ type: fc.constant("concede" as const), actor: memberArb }),
  fc.record({ type: fc.constant("undo" as const), actor: memberArb }),
  fc.record({
    type: fc.constant("resolve" as const),
    actor: memberArb,
    actorIsAdmin: fc.boolean(),
    outcome: fc.constantFrom("uphold" as const, "void" as const),
  }),
);

type Action =
  | { kind: "event"; event: VerificationEvent }
  | { kind: "photo" }
  | { kind: "settle" };

/** Something that happens to a row `offset` ms after it is logged. */
interface Step {
  offset: number;
  action: Action;
}

interface Claim {
  doneBy: string;
  loggedBy: string;
  confirmMode: "optimistic" | "partner";
  photo: boolean;
  gapMin: number;
  steps: Step[];
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  // Minute resolution, with a bias towards the undo window.
  offset: fc.oneof(
    fc.integer({ min: 0, max: 15 }).map((m) => m * MINUTE),
    fc.integer({ min: 0, max: SPAN / MINUTE }).map((m) => m * MINUTE),
  ),
  action: fc.oneof<fc.Arbitrary<Action>[]>(
    eventArb.map((event) => ({ kind: "event" as const, event })),
    fc.constant({ kind: "photo" as const }),
    fc.constant({ kind: "settle" as const }),
  ),
});

const historyArb: fc.Arbitrary<Claim[]> = fc.array(
  fc.record({
    doneBy: memberArb,
    loggedBy: memberArb,
    confirmMode: fc.constantFrom("optimistic" as const, "partner" as const),
    photo: fc.boolean(),
    gapMin: fc.integer({ min: 0, max: 3 * 24 * 60 }),
    steps: fc.array(stepArb, { maxLength: 8 }),
  }),
  { maxLength: 8 },
);

interface Timed {
  id: string;
  occurredAt: Date;
  row: VerificationRow;
}

/**
 * Play a history up to `t`, with or without the daily job settling rows along
 * the way. Events are checked against `effectiveStatus`, so the outcome of
 * every event must be the same either way.
 */
function play(history: Claim[], t: number, withSettle: boolean) {
  const outcomes: string[] = [];
  let clock = START;
  const rows: Timed[] = [];
  history.forEach((h, i) => {
    clock += h.gapMin * MINUTE;
    if (clock > t) return;
    const logged = new Date(clock);
    let row = initialVerification({
      doneBy: h.doneBy,
      loggedBy: h.loggedBy,
      confirmMode: h.confirmMode,
      loggedAt: logged,
      photoAttachedAt: h.photo ? logged : null,
    });
    const steps = [...h.steps].sort((a, b) => a.offset - b.offset);
    for (const { offset, action } of steps) {
      const now = clock + offset;
      if (now > t) break;
      if (action.kind === "event") {
        const r = transition(row, action.event, new Date(now));
        outcomes.push(r.ok ? r.row.status : r.code);
        if (r.ok) row = r.row;
      } else if (action.kind === "photo") {
        row = attachPhoto(row, new Date(now));
      } else if (withSettle) {
        row = settle(row, new Date(now));
      }
    }
    rows.push({ id: `c-${i}`, occurredAt: logged, row });
  });
  return { rows, outcomes };
}

const toReplay = ({ id, occurredAt, row }: Timed): ReplayCompletion => ({
  id,
  doneBy: row.doneBy,
  occurredAt,
  loggedAt: row.loggedAt,
  status: row.status,
  confirmMode: row.confirmMode,
});

const RULES = [{ ...BATHROOM, effectiveFrom: new Date(0) }];

describe("verification properties", () => {
  it("no time-derived transition changes the counted set: scores at t equal scores after settling up to t", () => {
    fc.assert(
      fc.property(
        historyArb,
        fc.integer({ min: 0, max: 20 * DAY }),
        (history, dt) => {
          const t = START + dt;
          const plain = play(history, t, false);
          const settled = play(history, t, true);
          // Settling along the way changes no event's outcome…
          expect(settled.outcomes).toEqual(plain.outcomes);
          // …nor the status any row has at t…
          plain.rows.forEach((p, i) => {
            const s = settled.rows[i]!;
            expect(effectiveStatus(s.row, new Date(t))).toBe(
              effectiveStatus(p.row, new Date(t)),
            );
          });
          // …and the scores computed at t equal those after persisting every
          // time-derived transition up to t.
          const atT = replayChore(plain.rows.map(toReplay), RULES);
          const persisted = plain.rows.map((r) => ({
            ...r,
            row: settle(r.row, new Date(t)),
          }));
          expect(replayChore(persisted.map(toReplay), RULES)).toEqual(atT);
          expect(replayChore(settled.rows.map(toReplay), RULES)).toEqual(atT);
        },
      ),
    );
  });

  it("settle is idempotent and agrees with effectiveStatus", () => {
    fc.assert(
      fc.property(
        historyArb,
        fc.integer({ min: 0, max: 20 * DAY }),
        (history, dt) => {
          const now = new Date(START + dt);
          for (const { row } of play(history, START + dt, false).rows) {
            const once = settle(row, now);
            expect(once.status).toBe(effectiveStatus(row, now));
            expect(settle(once, now)).toBe(once);
          }
        },
      ),
    );
  });
});
