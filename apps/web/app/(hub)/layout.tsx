import Link from "next/link";
import type { ReactNode } from "react";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findKioskPinLockedAt } from "@baumy/db/members";
import { AppShell, FormMessage, navItemClass } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { memberOrVisitorPage } from "@/lib/auth";
import { runSweepAfterResponse } from "@/lib/background-work";
import { activeRoster } from "@/lib/members/characters";
import { ScoreEmote } from "@/components/members/score-emote";
import { HubMenu, InboxBadge, NavLinks, type NavItem } from "./nav-links";

// The hub's shell (SPEC §7) around every page for household members. The
// gate here is for the frame; each page runs its own gate too, because a
// layout is not re-rendered on every client navigation. Nobody signed in
// gets no frame: `/` is then the public landing page (issue #96), and every
// other hub page's own gate sends them to sign-in.

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: ReactNode }) {
  const me = await memberOrVisitorPage();
  if (!me) return children;
  // Their character as every screen draws it (lib/members/characters.ts).
  const { characters, sprites } = await activeRoster(
    createHttpDb() as unknown as Queryable,
    HOUSEHOLD_ID,
  );
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
  // The main pages are the nav, named as on the kitchen screen (ADR 0005:
  // chores are Bounties, notes are the Board); Admin and the account fold into menus
  // (issue #64), so the header is one row on a laptop.
  const items: NavItem[] = [
    { href: "/", label: "Hub" },
    { href: "/chores", label: "Bounties" },
    { href: "/calendar", label: "Calendar" },
    { href: "/notes", label: "Board" },
    { href: "/shopping", label: "Shopping" },
    { href: "/scores", label: "Scores" },
    { href: "/pot", label: "Pot" },
    // With claims waiting, the inbox is pinned as a badge in the top row
    // instead, so the count is seen at every width.
    ...(waiting > 0
      ? []
      : ([{ href: "/inbox", label: "Needs your OK" }] as NavItem[])),
  ];
  const admin: NavItem[] = [
    { href: "/admin/members", label: "Members" },
    { href: "/admin/chores", label: "Edit chores" },
    { href: "/admin/weights", label: "Weights" },
    { href: "/admin/avatars", label: "Avatars" },
  ];
  return (
    <AppShell
      brand="Baumy"
      nav={<NavLinks items={items} />}
      user={
        <>
          {waiting > 0 ? <InboxBadge waiting={waiting} /> : null}
          {me.role === "admin" ? (
            <HubMenu label="Admin" items={admin} data-testid="admin-menu" />
          ) : null}
          <HubMenu
            label={
              <>
                <ScoreEmote
                  sprites={sprites.get(me.memberId)}
                  memberId={me.memberId}
                  avatar={characters.get(me.memberId) ?? me.avatar}
                  scale={1}
                />
                {/* On a phone only the character shows; the name is still
                    the button's accessible name. */}
                <span
                  data-testid="signed-in-as"
                  title={me.email}
                  className="inline-block max-w-48 truncate normal-case max-sm:sr-only"
                >
                  {me.displayName}
                </span>
              </>
            }
            items={[{ href: "/settings", label: "Settings" }]}
            data-testid="account-menu"
          >
            <Link href="/auth/sign-out" className={navItemClass(false)}>
              Sign out
            </Link>
          </HubMenu>
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
