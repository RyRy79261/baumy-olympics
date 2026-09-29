import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { members } from "@baumy/db/schema";
import { Card, FormMessage, PageHeading } from "@baumy/ui";
import { avatarFor } from "@baumy/types";
import { requireMemberPage } from "@/lib/auth";
import { activeCharacters } from "@/lib/members/characters";
import { telegramBotUsername } from "@/lib/telegram/deep-link";
import { AvatarForm } from "./avatar-form";
import { KioskPinForm, TelegramLinkForm } from "./settings-forms";

// /settings (SPEC §6.2): the member's own character (ADR 0005 §5), kiosk
// PIN and Telegram link. Every
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
        description="Your character, your sign-in security, your kiosk PIN, your Telegram link and your connected apps."
      />
      <div className="flex max-w-xl flex-col gap-6">
        {row?.kioskPinLockedAt ? (
          <FormMessage tone="error">
            Your kiosk PIN is locked after too many wrong tries. Set a new PIN
            below to unlock it.
          </FormMessage>
        ) : null}
        <AvatarForm
          initial={
            (
              await activeCharacters(
                createHttpDb() as unknown as Queryable,
                HOUSEHOLD_ID,
              )
            ).get(me.memberId) ??
            avatarFor({ id: me.memberId, avatar: me.avatar ?? null })
          }
        />
        <Card
          title="Security"
          description="Passkeys, two-factor, Google, your password and the devices signed in as you."
        >
          <Link href="/settings/security" className="text-sm underline">
            Manage sign-in and devices
          </Link>
        </Card>
        <KioskPinForm hasPin={Boolean(row?.kioskPinHash)} />
        <TelegramLinkForm
          telegramUserId={row?.telegramUserId ?? null}
          botUsername={telegramBotUsername()}
        />
        <Card
          title="Connected apps"
          description="Apps such as Claude that can reach Baumy as you over MCP."
        >
          <Link href="/settings/connections" className="text-sm underline">
            Manage connected apps
          </Link>
        </Card>
      </div>
    </>
  );
}
