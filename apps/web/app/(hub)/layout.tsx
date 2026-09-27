import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell, buttonClass } from "@baumy/ui";
import { requireMemberPage } from "@/lib/auth";
import { NavLinks, type NavItem } from "./nav-links";

// The hub's shell (SPEC §7) around every page for household members. The
// gate here is for the frame; each page runs its own gate too, because a
// layout is not re-rendered on every client navigation.

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: ReactNode }) {
  const me = await requireMemberPage();
  const items: NavItem[] = [
    { href: "/", label: "Hub" },
    { href: "/settings", label: "Settings" },
    ...(me.role === "admin"
      ? [{ href: "/admin/members", label: "Members" } as NavItem]
      : []),
  ];
  return (
    <AppShell
      brand="Baumy"
      nav={<NavLinks items={items} />}
      user={
        <>
          <span data-testid="signed-in-as" title={me.email}>
            {me.displayName}
          </span>
          <Link href="/auth/sign-out" className={buttonClass("secondary")}>
            Sign out
          </Link>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
