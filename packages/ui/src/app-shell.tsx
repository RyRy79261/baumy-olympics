import type { ReactNode } from "react";
import { BaumyCat } from "./baumy-cat";
import { cx } from "./cx";

// The hub's frame (SPEC §7, ADR 0005 Consequences): the phone and laptop
// hub keep a normal scrolling layout in the kitchen screen's kit. A dark
// header with Baumy and the brand, the main pages as Silkscreen links (the
// page you are on framed), and at the end the pinned and folded pieces (the
// app passes the "Needs your OK" badge and the NavMenus for Admin and the
// account); then one content column (max-w-6xl) that pages fill, starting
// with PageHeading. From xl (1280) it is all one row. Narrower, the brand and
// the menus share the top row and the page links wrap onto their own rows
// under it: every link stays on screen, nothing scrolls sideways out of
// sight. On a phone the brand shows only Baumy. Framework-free: the app
// passes its own links (next/link) in, styled with `navItemClass`. The
// bottom padding keeps the corner Baumy's button sits in clear of content.

/** The classes a nav link gets; `current` marks the page you are on. */
export function navItemClass(current: boolean): string {
  return cx(
    "inline-flex min-h-11 shrink-0 items-center px-2 font-label text-xs font-bold whitespace-nowrap uppercase sm:text-sm xl:text-xs",
    current
      ? "pixel-frame bg-bm-raised text-bm-text [--pf:var(--color-bm-violet)]"
      : "text-bm-muted hover:text-bm-text",
  );
}

/**
 * The classes of a link pinned in the header's top row as a badge (the
 * "Needs your OK" count): yellow-framed, so it is seen at every width.
 */
export function navBadgeClass(current: boolean): string {
  return cx(
    "pixel-frame inline-flex min-h-11 shrink-0 items-center px-2 font-label text-xs font-bold whitespace-nowrap uppercase sm:text-sm xl:text-xs",
    "text-bm-yellow [--pf:var(--color-bm-yellow)]",
    current ? "bg-bm-yellow/25" : "bg-bm-yellow/10",
  );
}

export function AppShell({
  brand,
  nav,
  user,
  children,
}: {
  brand: ReactNode;
  /** The nav links, each styled with navItemClass. */
  nav: ReactNode;
  /**
   * What stays pinned at the end of the top row: the "Needs your OK" badge
   * and the folded menus (Admin, the account: who is signed in, the way out).
   */
  user?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bm-bg text-bm-text">
      <header className="border-b-2 border-bm-line bg-bm-chrome">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 sm:gap-x-4 xl:flex-nowrap">
          <div className="flex shrink-0 items-end gap-2 font-display text-base">
            <BaumyCat scale={1} facing="right" />
            <span className="max-sm:sr-only">{brand}</span>
          </div>
          {/* Below xl the page links take their own rows under the brand,
              wrapping so none is ever out of sight. */}
          <nav
            aria-label="Main"
            className="flex min-w-0 flex-1 flex-wrap gap-1 max-xl:order-last max-xl:basis-full xl:flex-nowrap"
          >
            {nav}
          </nav>
          {user ? (
            <div className="ml-auto flex shrink-0 items-center gap-1 font-label text-sm text-bm-muted">
              {user}
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-40">{children}</main>
    </div>
  );
}
