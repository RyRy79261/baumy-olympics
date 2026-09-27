import { describe, expect, it } from "vitest";
import type { Proposal } from "./proposal";
import {
  approveAllSkips,
  approveAllTargets,
  asksForPin,
  canApprove,
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

describe("approve all", () => {
  it("skips destructive, invalid and settled rows, and on the kiosk rows that need a PIN", () => {
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

    expect(approveAllTargets(rows, true)).toEqual([ok, failed]);
    expect(approveAllTargets(rows, false)).toEqual([ok, failed, pin]);
    expect(approveAllSkips(rows, true)).toBe(
      "Approve all skips 1 that deletes something, 1 that isn't valid, 1 that needs your PIN: approve or reject those one by one.",
    );
    expect(
      approveAllSkips([destructive, destructive, invalid, invalid], false),
    ).toBe(
      "Approve all skips 2 that delete something, 2 that aren't valid: approve or reject those one by one.",
    );
    expect(approveAllSkips([pin, pin], true)).toContain("2 that need your PIN");
    expect(approveAllSkips([ok, saved], true)).toBeNull();
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

describe("savedMessage", () => {
  it("names the points when the action scored", () => {
    expect(savedMessage({ totalPts: 25 })).toBe("Saved: +25 points.");
    expect(savedMessage({ totalPts: null, counted: false })).toBe(
      "Saved. It counts once someone confirms it.",
    );
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
