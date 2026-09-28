"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { KioskFooter, KioskNavItem, kioskNavItemClass } from "@baumy/ui";
import { KIOSK_HOME, KIOSK_NAV, isNavActive } from "@/lib/kiosk/nav";

// The kitchen screen's frame around each page (ADR 0005 §1, issue #65).
// The dashboard home is the whole screen above the footer, with its own
// header; the other pages get the avatar bar over them (tap to pick who is
// acting) and scroll on their own, leaving Baumy's corner clear.

export function KioskFrame({
  top,
  children,
}: {
  /** The avatar bar, for every page but the home. */
  top: ReactNode;
  children: ReactNode;
}) {
  if (usePathname() === KIOSK_HOME) {
    return <main className="flex min-h-0 flex-1 flex-col">{children}</main>;
  }
  return (
    <>
      {top}
      <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 pb-14">
        {children}
      </main>
    </>
  );
}

/** The footer nav: Home, Bounties, Calendar, Board, Shop, Scores. */
export function KioskNav() {
  const pathname = usePathname();
  return (
    <KioskFooter>
      {KIOSK_NAV.map((n) => {
        const active = isNavActive(n.href, pathname);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={kioskNavItemClass(active)}
          >
            <KioskNavItem glyph={n.glyph} label={n.label} />
          </Link>
        );
      })}
    </KioskFooter>
  );
}
