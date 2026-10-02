import Link from "next/link";
import type { ReactNode } from "react";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findKioskPinLockedAt } from "@baumy/db/members";
import { AppShell, FormMessage, navItemClass } from "@baumy/ui";
import { memberOrVisitorPage } from "@/lib/auth";
import { runSweepAfterResponse } from "@/lib/background-work";
import { householdRoster } from "@/lib/members/household";
import { FeedbackGate } from "@/components/feedback/feedback-gate";
import { ScoreEmote } from "@/components/members/score-emote";
import { reportAiAvailable } from "@/lib/feedback/ai";
import { HubMenu, NavLinks, type NavItem } from "./nav-links";

// The hub's shell (SPEC §7) around every page for household members. The
// gate here is for the frame; each page runs its own gate too, because a
// layout is not re-rendered on every client navigation. Nobody signed in
// gets no frame: `/` is then the public landing page (issue #96), and every
// other hub page's own gate sends them to sign-in.

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: ReactNode }) {
  const me = await memberOrVisitorPage();
  if (!me) return children;
  // SPEC §6.7: the daily job's sweep, at most every 15 minutes, after this
  // response (lib/background-work.ts). Nothing on the page waits on it.
  runSweepAfterResponse();
  // The frame's two reads are independent, so they run side by side
  // (issue #128): one database round trip of waiting, not two.
  const db = createHttpDb() as unknown as Queryable;
  const [roster, pinLockedAt] = await Promise.all([
    // Their look as every screen shows it (lib/members/characters.ts).
    householdRoster(HOUSEHOLD_ID),
    // SPEC §6.2: after 10 wrong PINs at the kiosk, the member hears about it
    // on their own device, on every page, until they set a new PIN.
    findKioskPinLockedAt(db, me.memberId),
  ]);
  const look = roster.get(me.memberId);
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
    // What happened in the house (issue #150); not an inbox, and no count.
    { href: "/activity", label: "Activity" },
  ];
  const admin: NavItem[] = [
    { href: "/admin/members", label: "Members" },
    { href: "/admin/kitchen-screen", label: "Kitchen screen" },
    { href: "/admin/chores", label: "Edit chores" },
    { href: "/admin/weights", label: "Weights" },
    { href: "/admin/avatars", label: "Avatars" },
    { href: "/admin/connections", label: "Connections" },
  ];
  return (
    <AppShell
      brand="Baumy"
      nav={<NavLinks items={items} />}
      user={
        <>
          {me.role === "admin" ? (
            <HubMenu label="Admin" items={admin} data-testid="admin-menu" />
          ) : null}
          <HubMenu
            label={
              <>
                <ScoreEmote
                  sprites={look?.sprites}
                  name={me.displayName}
                  colour={look?.colour}
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
      {/* Shake to report, and the "Report this bug" offer (issue #133). */}
      <FeedbackGate surface="ui" aiAvailable={reportAiAvailable()} />
    </AppShell>
  );
}
