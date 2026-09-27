"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { navItemClass } from "@baumy/ui";

export interface NavItem {
  href: Route;
  label: string;
}

/** The hub nav, marking the page you are on. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return items.map((item) => {
    const current =
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
