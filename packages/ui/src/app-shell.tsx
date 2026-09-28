import type { ReactNode } from "react";
import { BaumyCat } from "./baumy-cat";
import { cx } from "./cx";

// The hub's frame (SPEC §7, ADR 0005 Consequences): the phone and laptop
// hub keep a normal scrolling layout in the kitchen screen's kit. A dark
// header with Baumy and the brand, the main pages as one row of Silkscreen
// links (the page you are on framed), and the folded rest (NavMenu: Admin,
// the account) at the end; then one content column (max-w-6xl) that pages
// fill, starting with PageHeading. On a laptop it is one row; on a phone
// the brand and the menus share the top row and the page links get their
// own row, which scrolls sideways instead of wrapping. Framework-free: the
// app passes its own links (next/link) in, styled with `navItemClass`. The
// bottom padding keeps the corner Baumy's button sits in clear of content.

/** The classes a nav link gets; `current` marks the page you are on. */
export function navItemClass(current: boolean): string {
  return cx(
    "inline-flex min-h-11 shrink-0 items-center px-2 font-label text-xs font-bold whitespace-nowrap uppercase sm:text-sm lg:text-xs",
    current
      ? "pixel-frame bg-bm-raised text-bm-text [--pf:var(--color-bm-violet)]"
      : "text-bm-muted hover:text-bm-text",
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
  /** The folded menus (Admin, the account: who is signed in, the way out). */
  user?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bm-bg text-bm-text">
      <header className="border-b-2 border-bm-line bg-bm-chrome">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 sm:gap-x-4 lg:flex-nowrap">
          <div className="flex shrink-0 items-end gap-2 font-display text-sm sm:text-base">
            <BaumyCat scale={1} facing="right" />
            {brand}
          </div>
          {/* Below lg the nav takes its own full-width row under the brand,
              and scrolls sideways rather than wrap. */}
          <nav
            aria-label="Main"
            className="-mx-1 flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto px-1 [scrollbar-width:thin] max-lg:order-last max-lg:basis-full"
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
