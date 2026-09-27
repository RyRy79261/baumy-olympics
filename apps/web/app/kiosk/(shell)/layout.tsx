import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { listActiveMembers } from "@baumy/db/members";
import { AvatarButton, Button, KioskShell } from "@baumy/ui";
import { IdleReset } from "@/components/kiosk/idle-reset";
import { getKioskActor } from "@/lib/auth";
import { runSweepAfterResponse } from "@/lib/background-work";
import { clearPickAction, pickMemberAction } from "../actions";

// The kitchen kiosk's shell (SPEC §8): a landscape screen, signed in as a
// paired DEVICE, with the household's avatars along the top. Tapping one
// makes that member the one acting; 60 seconds idle forgets them. An
// unpaired or revoked device is sent to /kiosk/pair. Nothing here links to
// the hub or to admin pages, and admin actions refuse the kiosk anyway.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kiosk - Baumy" };

export default async function KioskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  // The kitchen screen is the page loaded most: it runs the daily job's
  // sweep too, at most every 15 minutes (lib/background-work.ts).
  runSweepAfterResponse();
  const people = await listActiveMembers(
    createHttpDb() as unknown as Queryable,
    HOUSEHOLD_ID,
  );

  return (
    <KioskShell
      brand="Baumy"
      avatars={people.map((p) => (
        <form key={p.id} action={pickMemberAction}>
          <input type="hidden" name="memberId" value={p.id} />
          <AvatarButton
            type="submit"
            displayName={p.displayName}
            sprite={p.avatarSprite}
            color={p.color}
            selected={p.id === kiosk.memberId}
          />
        </form>
      ))}
      status={
        kiosk.memberId ? (
          <>
            <span data-testid="acting-as">{kiosk.displayName}</span>
            <form action={clearPickAction}>
              <Button type="submit" size="kiosk" variant="secondary">
                Done
              </Button>
            </form>
          </>
        ) : (
          <span className="text-base text-neutral-600">Tap your avatar</span>
        )
      }
    >
      <IdleReset active={Boolean(kiosk.memberId)} />
      {children}
    </KioskShell>
  );
}
