import type { ReactNode } from "react";
import { cx } from "./cx";

// The hub's frame (SPEC §7): a header with the brand, the nav and the user,
// then one content column (max-w-6xl) that pages fill, starting with
// PageHeading. Framework-free: the app passes its own links (next/link) in,
// styled with `navItemClass`. Issue #7 turns the nav into pills that fold
// into a sheet on small screens; for now it wraps.

/** The classes a nav link gets; `current` marks the page you are on. */
export function navItemClass(current: boolean): string {
  return cx(
    "inline-flex min-h-11 items-center rounded px-3 text-sm",
    current
      ? "bg-neutral-900 font-semibold text-white"
      : "text-neutral-800 hover:bg-neutral-200",
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
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-300 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <div className="text-lg font-bold">{brand}</div>
          <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
            {nav}
          </nav>
          {user ? (
            <div className="flex items-center gap-3 text-sm">{user}</div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
