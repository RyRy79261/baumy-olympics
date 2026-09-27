import { describe, expect, it } from "vitest";
import { formatBerlinDateTime } from "@baumy/core";
import type { ClaimView } from "@/lib/actions/get-pending-confirmations";
import {
  claimStatusLine,
  claimTitle,
  needsOkLabel,
  settledLabel,
} from "./view";

const T = "2026-09-28T06:00:00.000Z";
const berlin = formatBerlinDateTime(new Date(T));

const base: Pick<
  ClaimView,
  | "status"
  | "confirmMode"
  | "finalizesAt"
  | "expiresAt"
  | "windowEndsAt"
  | "dispute"
  | "photoUrl"
  | "totalPts"
> = {
  status: "pending",
  confirmMode: "optimistic",
  finalizesAt: T,
  expiresAt: null,
  windowEndsAt: T,
  dispute: null,
  photoUrl: null,
  totalPts: 20,
};

describe("claim labels", () => {
  it("names the doer, and the logger when it was someone else", () => {
    const c = {
      doneBy: "a",
      doneByName: "Ryan",
      loggedBy: "a",
      loggedByName: "Ryan",
      choreName: "Trash",
    };
    expect(claimTitle(c)).toBe("Ryan did Trash");
    expect(claimTitle({ ...c, loggedBy: "b", loggedByName: "Sam" })).toBe(
      "Ryan did Trash (logged by Sam)",
    );
  });

  it("says what happens next, in Berlin time", () => {
    expect(claimStatusLine(base)).toBe(
      `+20, final at ${berlin} unless someone disputes it.`,
    );
    expect(claimStatusLine({ ...base, totalPts: null })).toBe(
      `final at ${berlin} unless someone disputes it.`,
    );
    expect(
      claimStatusLine({
        ...base,
        confirmMode: "partner",
        finalizesAt: null,
        expiresAt: T,
      }),
    ).toBe(
      `Counts once someone else confirms it. Voided at ${berlin} if nobody does.`,
    );
    const disputed = {
      ...base,
      status: "disputed" as const,
      dispute: { raisedBy: "b", raisedByName: "Sam", reason: "still full" },
    };
    expect(claimStatusLine(disputed)).toBe(
      `Disputed by Sam: "still full". Without a photo it is voided at ${berlin}.`,
    );
    expect(claimStatusLine({ ...disputed, photoUrl: "/api/blob?x" })).toContain(
      "It has a photo, so it stays disputed",
    );
    expect(claimStatusLine({ ...disputed, dispute: null })).toMatch(
      /^Disputed by Someone\. /,
    );
  });

  it("labels settled claims and the banner count", () => {
    const s = {
      completionId: "c",
      choreName: "Trash",
      loggedAt: T,
      totalPts: 20,
      voidReason: null,
    };
    expect(settledLabel({ ...s, status: "finalized" })).toBe(
      "Trash: finalized, +20",
    );
    expect(settledLabel({ ...s, status: "confirmed", totalPts: null })).toBe(
      "Trash: confirmed",
    );
    expect(
      settledLabel({ ...s, status: "voided", voidReason: "unconfirmed" }),
    ).toBe("Trash: voided (nobody confirmed it)");
    expect(settledLabel({ ...s, status: "voided", voidReason: "odd" })).toBe(
      "Trash: voided (odd)",
    );
    expect(settledLabel({ ...s, status: "voided" })).toBe("Trash: voided");
    expect(needsOkLabel(1)).toBe("1 claim needs your OK");
    expect(needsOkLabel(3)).toBe("3 claims need your OK");
  });
});
