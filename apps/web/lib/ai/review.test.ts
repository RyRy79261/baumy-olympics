import { describe, expect, it } from "vitest";
import type { Proposal } from "./proposal";
import {
  asksForPin,
  canApprove,
  cancelAll,
  cardTone,
  confirmAllTargets,
  confirmNeedsPin,
  isOpen,
  stopsPin,
  visibleRows,
  nextHistory,
  rowsFor,
  savedMessage,
  withField,
  type ReviewRow,
} from "./review";

let n = 0;
function proposal(over: Partial<Proposal> = {}): Proposal {
  n += 1;
  return {
    proposalId: `p-${n}`,
    name: "log_completion",
    title: "Log a chore",
    input: {},
    preview: "Log Trash",
    risk: "confirm",
    valid: true,
    needsPin: false,
    fields: [],
    ...over,
  };
}

const row = (p: Proposal, over: Partial<ReviewRow> = {}): ReviewRow => ({
  ...rowsFor([p])[0]!,
  ...over,
});

describe("confirm all", () => {
  it("runs every valid open card in order, destructive and PIN ones included", () => {
    const ok = row(proposal());
    const failed = row(proposal(), { state: "failed" });
    const saved = row(proposal(), { state: "saved" });
    const rejected = row(proposal(), { state: "rejected" });
    const saving = row(proposal(), { state: "saving" });
    const destructive = row(proposal({ risk: "destructive" }));
    const invalid = row(proposal({ valid: false }));
    const pin = row(proposal({ needsPin: true }));
    const rows = [
      ok,
      failed,
      saved,
      rejected,
      saving,
      destructive,
      invalid,
      pin,
    ];

    expect(confirmAllTargets(rows)).toEqual([ok, failed, destructive, pin]);
    expect(confirmNeedsPin(rows, true)).toBe(true);
    expect(confirmNeedsPin(rows, false)).toBe(false);
    expect(
      confirmNeedsPin(
        [ok, row(proposal({ needsPin: true }), { state: "saved" })],
        true,
      ),
    ).toBe(false);
    expect(visibleRows(rows)).not.toContain(rejected);
    expect(visibleRows(rows)).toContain(ok);
    expect(cardTone(destructive)).toBe("destructive");
    expect(cardTone(invalid)).toBe("invalid");
    expect(cardTone(row(proposal({ valid: false, risk: "destructive" })))).toBe(
      "invalid",
    );
    expect(cardTone(ok)).toBe("normal");
  });

  it("cancel rejects every open card and keeps the saved ones", () => {
    const ok = row(proposal());
    const failed = row(proposal(), { state: "failed", message: "Nope." });
    const saved = row(proposal(), { state: "saved", message: "Saved." });
    expect(
      cancelAll([ok, failed, saved]).map((r) => [r.state, r.message]),
    ).toEqual([
      ["rejected", undefined],
      ["rejected", undefined],
      ["saved", "Saved."],
    ]);
  });

  it("lets a row be approved while it waits or after it failed, if valid", () => {
    expect(canApprove(row(proposal()))).toBe(true);
    expect(canApprove(row(proposal(), { state: "failed" }))).toBe(true);
    expect(canApprove(row(proposal(), { state: "saved" }))).toBe(false);
    expect(canApprove(row(proposal({ valid: false })))).toBe(false);
  });
});

describe("rowsFor", () => {
  it("starts every row waiting, carrying the PIN flag", () => {
    const p = proposal({ needsPin: true });
    expect(rowsFor([p])).toEqual([
      { proposal: p, state: "pending", needsPin: true },
    ]);
  });
});

describe("asksForPin", () => {
  it("is true only for a failure with a PIN code", () => {
    const codes = new Set(["ATTESTATION_REQUIRED"]);
    expect(
      asksForPin(
        { ok: false, code: "ATTESTATION_REQUIRED", message: "" },
        codes,
      ),
    ).toBe(true);
    expect(
      asksForPin({ ok: false, code: "COOLDOWN", message: "" }, codes),
    ).toBe(false);
    expect(asksForPin({ ok: true, data: null }, codes)).toBe(false);
  });
});

describe("stopsPin", () => {
  it("stops sending the PIN once it was refused, resting or locked", () => {
    for (const code of [
      "ATTESTATION_REQUIRED",
      "ATTESTATION_FAILED",
      "RATE_LIMITED",
      "PIN_LOCKED",
    ]) {
      expect(stopsPin(code), code).toBe(true);
    }
    // A card failing for its own reason says nothing about the PIN.
    expect(stopsPin("COOLDOWN")).toBe(false);
    expect(stopsPin("NOT_FOUND")).toBe(false);
  });
});

describe("isOpen", () => {
  it("is a card still waiting, or failed and worth another go", () => {
    expect(isOpen(row(proposal()))).toBe(true);
    expect(isOpen(row(proposal(), { state: "failed" }))).toBe(true);
    for (const state of ["saving", "saved", "rejected"] as const) {
      expect(isOpen(row(proposal(), { state })), state).toBe(false);
    }
  });
});

describe("savedMessage", () => {
  it("names the points when the action scored", () => {
    expect(savedMessage({ totalPts: 25 })).toBe("Saved: +25 points.");
    expect(savedMessage({ totalPts: null })).toBe("Saved.");
    expect(savedMessage(null)).toBe("Saved.");
  });
});

describe("withField", () => {
  it("sets a field, and removes it when emptied", () => {
    expect(withField({ a: 1 }, "b", "x")).toEqual({ a: 1, b: "x" });
    expect(withField({ a: 1, b: "x" }, "b", "")).toEqual({ a: 1 });
    expect(withField({ a: 1 }, "a", undefined)).toEqual({});
    expect(withField({ a: 1 }, "a", null)).toEqual({});
    expect(withField({ a: 1 }, "a", false)).toEqual({ a: false });
  });
});

describe("nextHistory", () => {
  it("adds the exchange and keeps the newest turns", () => {
    const h = nextHistory([], "hi", "hello");
    expect(h).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
    const long = nextHistory(h, "a", "b", 3);
    expect(long).toEqual([
      { role: "assistant", text: "hello" },
      { role: "user", text: "a" },
      { role: "assistant", text: "b" },
    ]);
  });
});
