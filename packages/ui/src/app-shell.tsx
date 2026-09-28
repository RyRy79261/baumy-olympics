import type { ReactNode } from "react";
import { BaumyCat } from "./baumy-cat";
import { cx } from "./cx";

// The hub's frame (SPEC §7, ADR 0005 Consequences): the phone and laptop
// hub keep a normal scrolling layout in the kitchen screen's kit. A dark
// header with Baumy and the brand, the nav as Silkscreen pills (the page you
// are on framed), the user, then one content column (max-w-6xl) that pages
// fill, starting with PageHeading. Framework-free: the app passes its own
// links (next/link) in, styled with `navItemClass`.

/** The classes a nav link gets; `current` marks the page you are on. */
export function navItemClass(current: boolean): string {
  return cx(
    "inline-flex min-h-11 items-center px-3 font-label text-sm font-bold tracking-wide uppercase",
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
  /** Who is signed in, and the way out. */
  user?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bm-bg text-bm-text">
      <header className="border-b-2 border-bm-line bg-[#0f0918]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <div className="flex items-end gap-2 font-display text-base">
            <BaumyCat scale={1} facing="right" />
            {brand}
          </div>
          {/* On a phone the nav takes its own full-width row under the brand. */}
          <nav
            aria-label="Main"
            className="flex flex-1 flex-wrap gap-1 max-sm:order-last max-sm:basis-full"
          >
            {nav}
          </nav>
          {user ? (
            <div className="flex items-center gap-3 font-label text-sm text-bm-muted max-sm:ml-auto">
              {user}
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
