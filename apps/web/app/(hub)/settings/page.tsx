import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { createHttpDb } from "@baumy/db";
import { members } from "@baumy/db/schema";
import { FormMessage, PageHeading } from "@baumy/ui";
import { requireMemberPage } from "@/lib/auth";
import { KioskPinForm, TelegramLinkForm } from "./settings-forms";

// /settings (SPEC §6.2): the member's own kiosk PIN and Telegram link. Every
// action here needs the member's own session (requireSession), never the
// kiosk.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings - Baumy Olympics" };

export default async function SettingsPage() {
  const me = await requireMemberPage();
  const [row] = await createHttpDb()
    .select({
      kioskPinHash: members.kioskPinHash,
      kioskPinLockedAt: members.kioskPinLockedAt,
      telegramUserId: members.telegramUserId,
    })
    .from(members)
    .where(eq(members.id, me.memberId));

  return (
    <>
      <PageHeading
        title="Settings"
        description="Your kiosk PIN and your Telegram link."
      />
      <div className="flex max-w-xl flex-col gap-6">
        {row?.kioskPinLockedAt ? (
          <FormMessage tone="error">
            Your kiosk PIN is locked after too many wrong tries. Set a new PIN
            below to unlock it.
          </FormMessage>
        ) : null}
        <KioskPinForm hasPin={Boolean(row?.kioskPinHash)} />
        <TelegramLinkForm linked={row?.telegramUserId != null} />
      </div>
    </>
  );
}
