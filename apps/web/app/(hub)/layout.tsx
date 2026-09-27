import Link from "next/link";
import type { ReactNode } from "react";
import { createHttpDb, type Queryable } from "@baumy/db";
import { findKioskPinLockedAt } from "@baumy/db/members";
import { AppShell, FormMessage, buttonClass } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { runSweepAfterResponse } from "@/lib/background-work";
import { NavLinks, type NavItem } from "./nav-links";

// The hub's shell (SPEC §7) around every page for household members. The
// gate here is for the frame; each page runs its own gate too, because a
// layout is not re-rendered on every client navigation.

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: ReactNode }) {
  const me = await requireMemberPage();
  // SPEC §6.7: the daily job's sweep, at most every 15 minutes, after this
  // response (lib/background-work.ts). Nothing on the page waits on it.
  runSweepAfterResponse();
  // SPEC §6.2: after 10 wrong PINs at the kiosk, the member hears about it
  // on their own device, on every page, until they set a new PIN.
  const pinLockedAt = await findKioskPinLockedAt(
    createHttpDb() as unknown as Queryable,
    me.memberId,
  );
  // "Needs your OK" shows how many claims wait on this member (SPEC §4.3).
  const pending = await runAction(
    "get_pending_confirmations",
    {},
    (await uiRequestCtx(undefined))!,
  );
  const waiting = pending.ok ? pending.data.needsYouCount : 0;
  const items: NavItem[] = [
    { href: "/", label: "Hub" },
    { href: "/chores", label: "Chores" },
    { href: "/calendar", label: "Calendar" },
    { href: "/notes", label: "Notes" },
    { href: "/scores", label: "Scores" },
    { href: "/pot", label: "Pot" },
    {
      href: "/inbox",
      label: waiting > 0 ? `Needs your OK (${waiting})` : "Needs your OK",
    },
    { href: "/settings", label: "Settings" },
    ...(me.role === "admin"
      ? ([
          { href: "/admin/members", label: "Members" },
          { href: "/admin/chores", label: "Edit chores" },
          { href: "/admin/weights", label: "Weights" },
        ] as NavItem[])
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
      {pinLockedAt ? (
        <div className="mb-6" data-testid="kiosk-pin-locked">
          <FormMessage tone="error">
            Your kiosk PIN was locked after 10 wrong tries at the kiosk. If that
            was not you, tell your household.{" "}
            <Link href="/settings" className="underline">
              Set a new PIN
            </Link>{" "}
            to unlock it.
          </FormMessage>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
