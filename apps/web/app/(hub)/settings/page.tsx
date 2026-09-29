import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { members } from "@baumy/db/schema";
import { Card, FormMessage, PageHeading } from "@baumy/ui";
import { avatarFor } from "@baumy/types";
import { requireMemberPage } from "@/lib/auth";
import { listAvatars } from "@baumy/db/avatars";
import { avatarImageView } from "@/lib/avatars/paths";
import { activeCharacters } from "@/lib/members/characters";
import { AvatarForm } from "./avatar-form";
import { GalleryForm } from "./gallery-form";
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
      avatarImageId: members.avatarImageId,
    })
    .from(members)
    .where(eq(members.id, me.memberId));
  const db = createHttpDb() as unknown as Queryable;
  // The gallery (issue #111): once it has characters, "Your character" is
  // a pick from it; until then, the drawn character's options.
  const gallery = await listAvatars(db, HOUSEHOLD_ID);
  const live = gallery.filter((a) => a.archivedAt === null);
  const worn = gallery.find((a) => a.id === row?.avatarImageId);
  const character =
    (await activeCharacters(db, HOUSEHOLD_ID)).get(me.memberId) ??
    avatarFor({ id: me.memberId, avatar: me.avatar ?? null });

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
        {live.length > 0 ? (
          <GalleryForm
            memberId={me.memberId}
            character={character}
            options={live.map((a) => ({
              id: a.id,
              name: a.name,
              sprites: avatarImageView(a)!,
            }))}
            picked={row?.avatarImageId ?? ""}
            archivedName={worn?.archivedAt ? worn.name : undefined}
          />
        ) : null}
        <AvatarForm initial={character} secondary={live.length > 0} />
        <Card
          title="Security"
          description="Passkeys, two-factor, Google, your password and the devices signed in as you."
        >
          <Link href="/settings/security" className="text-sm underline">
            Manage sign-in and devices
          </Link>
        </Card>
        <KioskPinForm hasPin={Boolean(row?.kioskPinHash)} />
        <TelegramLinkForm linked={row?.telegramUserId != null} />
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
