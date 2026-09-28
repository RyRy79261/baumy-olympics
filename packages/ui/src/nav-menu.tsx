"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { navItemClass } from "./app-shell";
import { cx } from "./cx";

// A menu in the hub header (issue #64): a nav-styled button that opens a
// pixel-framed panel of links under it. The hub keeps its main pages in the
// one-row nav and folds the rest (Admin, the account) into these. It closes
// on Escape, on a press outside, and when `closeKey` changes (the app passes
// the path, so following a link closes it).

export function NavMenu({
  label,
  closeKey,
  children,
  "data-testid": testId,
}: {
  /** What the button shows. */
  label: ReactNode;
  /** Change it to close the menu (the current path). */
  closeKey: string;
  /** The links, each styled with navItemClass. */
  children: ReactNode;
  "data-testid"?: string;
}) {
  // Open for one path only: navigating away closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === closeKey;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpenAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpenAt(open ? null : closeKey)}
        className={cx(navItemClass(open), "gap-2")}
      >
        {label}
        <span aria-hidden className="text-[0.6em]">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div
          data-menu
          className="pixel-frame pixel-frame-4 absolute top-full right-0 z-40 mt-2 flex w-max min-w-48 flex-col gap-1 bg-bm-raised p-2 [--pf:var(--color-bm-violet)]"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
