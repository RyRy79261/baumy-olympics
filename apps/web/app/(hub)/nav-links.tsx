"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { ReactNode } from "react";
import { NavMenu, navItemClass } from "@baumy/ui";

export interface NavItem {
  href: Route;
  label: string;
}

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** The hub nav, marking the page you are on. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return items.map((item) => {
    const current = isCurrent(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={navItemClass(current)}
        aria-current={current ? "page" : undefined}
      >
        {item.label}
      </Link>
    );
  });
}

/**
 * A folded group of hub links (Admin, the account menu). It closes when the
 * path changes, so following one of its links closes it.
 */
export function HubMenu({
  label,
  items,
  children,
  "data-testid": testId,
}: {
  label: ReactNode;
  items: NavItem[];
  /** Extra entries after the links (the sign-out link). */
  children?: ReactNode;
  "data-testid"?: string;
}) {
  const pathname = usePathname();
  return (
    <NavMenu label={label} closeKey={pathname} data-testid={testId}>
      <NavLinks items={items} />
      {children}
    </NavMenu>
  );
}
