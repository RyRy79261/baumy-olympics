import { describe, expect, it } from "vitest";
import { KIOSK_NAV, isNavActive } from "./nav";

// The kitchen screen's footer nav (ADR 0005 §1).

describe("the kiosk footer nav", () => {
  it("has the six pages in order", () => {
    expect(KIOSK_NAV.map((n) => n.label)).toEqual([
      "Home",
      "Bounties",
      "Calendar",
      "Board",
      "Shop",
      "Scores",
    ]);
    expect(KIOSK_NAV.every((n) => n.href.startsWith("/kiosk"))).toBe(true);
  });

  it("marks Home only on the home, and a page on itself and below", () => {
    expect(isNavActive("/kiosk", "/kiosk")).toBe(true);
    expect(isNavActive("/kiosk", "/kiosk/chores")).toBe(false);
    expect(isNavActive("/kiosk/chores", "/kiosk/chores")).toBe(true);
    expect(isNavActive("/kiosk/chores", "/kiosk/chores/x")).toBe(true);
    expect(isNavActive("/kiosk/chores", "/kiosk/choresx")).toBe(false);
    expect(isNavActive("/kiosk/chores", "/kiosk")).toBe(false);
  });
});
