import type { Route } from "next";
import type { GlyphName } from "@baumy/ui";

// The kitchen screen's footer nav (ADR 0005 §1): its pages, in order, and
// which one is on screen. Pure and client-safe.

export const KIOSK_HOME = "/kiosk";

export const KIOSK_NAV: readonly {
  href: Route;
  label: string;
  glyph: GlyphName;
}[] = [
  { href: "/kiosk", label: "Home", glyph: "home" },
  { href: "/kiosk/chores", label: "Bounties", glyph: "board" },
  { href: "/kiosk/calendar", label: "Calendar", glyph: "calendar" },
  { href: "/kiosk/notes", label: "Board", glyph: "msg" },
  { href: "/kiosk/shopping", label: "Shop", glyph: "shop" },
  { href: "/kiosk/scores", label: "Scores", glyph: "trophy" },
];

/** Whether a footer item is the page on screen (Home only on the home). */
export function isNavActive(href: string, pathname: string): boolean {
  return href === KIOSK_HOME
    ? pathname === KIOSK_HOME
    : pathname === href || pathname.startsWith(`${href}/`);
}
