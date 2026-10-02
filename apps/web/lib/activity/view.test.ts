import { describe, expect, it } from "vitest";
import { formatBerlinDateTime } from "@baumy/core";
import type {
  ActivityBountyView,
  ActivityChoreView,
  ActivityDisputeView,
  ActivityPointsView,
} from "@/lib/actions/get-activity";
import { choreStatusLine, choreTitle, entryLine, entryTime } from "./view";

// What the activity log says about each entry (issue #150).

const T = "2026-09-28T06:00:00.000Z";
const berlin = formatBerlinDateTime(new Date(T));
const ryan = { memberId: "a", displayName: "Ryan" };
const sam = { memberId: "b", displayName: "Sam" };

const chore: Pick<
  ActivityChoreView,
  "status" | "voidReason" | "windowEndsAt" | "dispute" | "photoUrl" | "totalPts"
> = {
  status: "pending",
  voidReason: null,
  windowEndsAt: T,
  dispute: null,
  photoUrl: null,
  totalPts: 20,
};

describe("chore entries", () => {
  it("names the doer, and the logger when it was someone else", () => {
    const c = { doneBy: ryan, loggedBy: ryan, choreName: "Trash" };
    expect(choreTitle(c)).toBe("Ryan did Trash");
    expect(choreTitle({ ...c, loggedBy: sam })).toBe(
      "Ryan did Trash (logged by Sam)",
    );
  });

  it("says when it happened, in Berlin time", () => {
    expect(entryTime({ at: T })).toBe(berlin);
  });

  it("says a pending claim counts now and when it is final", () => {
    expect(choreStatusLine(chore)).toBe(
      `+20. Final at ${berlin} unless someone disputes it.`,
    );
    expect(choreStatusLine({ ...chore, totalPts: null })).toBe(
      `Final at ${berlin} unless someone disputes it.`,
    );
  });

  it("says who disputed it and what happens without a photo, or with one", () => {
    const disputed = {
      ...chore,
      status: "disputed" as const,
      totalPts: null,
      dispute: { raisedBy: sam, reason: "still full" },
    };
    expect(choreStatusLine(disputed)).toBe(
      `Disputed by Sam: "still full". Without a photo it is voided at ${berlin}.`,
    );
    expect(
      choreStatusLine({ ...disputed, photoUrl: "/api/blob?pathname=x" }),
    ).toContain("stays disputed until the dispute is withdrawn");
    expect(choreStatusLine({ ...disputed, dispute: null })).toMatch(
      /^Disputed by Someone\. /,
    );
  });

  it("says how it settled, and why a voided one was voided", () => {
    for (const status of ["finalized", "confirmed"] as const) {
      expect(choreStatusLine({ ...chore, status })).toBe("+20. Settled.");
    }
    const voided = { ...chore, status: "voided" as const, totalPts: null };
    expect(choreStatusLine({ ...voided, voidReason: "undone" })).toBe(
      "Voided (undone).",
    );
    // A partner-mode claim nobody confirmed, from before issue #150.
    expect(choreStatusLine({ ...voided, voidReason: "unconfirmed" })).toBe(
      "Voided (expired).",
    );
    expect(choreStatusLine({ ...voided, voidReason: "other" })).toBe(
      "Voided (other).",
    );
    expect(choreStatusLine(voided)).toBe("Voided.");
  });
});

describe("the other entries", () => {
  const dispute: ActivityDisputeView = {
    kind: "dispute",
    id: "dispute:1",
    at: T,
    completionId: "c1",
    choreName: "Trash",
    doneBy: ryan,
    raisedBy: sam,
    reason: "still full",
    resolution: null,
    resolvedAt: null,
  };

  it("says who disputed whose chore, and how it ended", () => {
    expect(entryLine(dispute)).toBe(
      `Sam disputed Ryan's Trash: "still full". Open.`,
    );
    expect(entryLine({ ...dispute, resolution: "withdrawn" })).toMatch(
      /Withdrawn\.$/,
    );
    expect(entryLine({ ...dispute, resolution: "expired" })).toMatch(
      /Expired with no photo, so the chore was voided\.$/,
    );
    expect(entryLine({ ...dispute, resolution: "odd" })).toMatch(/odd$/);
  });

  it("says who added or edited a bounty", () => {
    const bounty: ActivityBountyView = {
      kind: "bounty",
      id: "bounty:1",
      at: T,
      choreId: "x",
      choreName: "Windows",
      change: "added",
      by: ryan,
    };
    expect(entryLine(bounty)).toBe("Ryan added the bounty Windows.");
    expect(entryLine({ ...bounty, change: "edited", by: null })).toBe(
      "Someone edited the bounty Windows.",
    );
  });

  it("says what a points change does, and who scheduled or vetoed it", () => {
    const points: ActivityPointsView = {
      kind: "points",
      id: "points:1:scheduled",
      at: T,
      suggestionId: "s1",
      choreId: "x",
      choreName: "Trash",
      event: "scheduled",
      by: ryan,
      fromPoints: 20,
      toPoints: 30,
      fromCooldownMinutes: 1440,
      toCooldownMinutes: 1440,
      appliesAt: T,
      reason: "smelly",
      canVeto: true,
    };
    const change = "20 → 30 pts, cooldown 1 day → 1 day";
    expect(entryLine(points)).toBe(
      `Ryan scheduled new points for Trash: ${change}, from ${berlin} unless someone vetoes it. Reason: smelly`,
    );
    expect(entryLine({ ...points, by: null, reason: null })).toBe(
      `Someone scheduled new points for Trash: ${change}, from ${berlin} unless someone vetoes it.`,
    );
    expect(entryLine({ ...points, event: "applied", by: null })).toBe(
      `New points for Trash applied: ${change}.`,
    );
    expect(entryLine({ ...points, event: "vetoed", by: sam })).toBe(
      `Sam vetoed new points for Trash: ${change}.`,
    );
    expect(entryLine({ ...points, event: "vetoed", by: null })).toMatch(
      /^Someone vetoed/,
    );
  });
});
