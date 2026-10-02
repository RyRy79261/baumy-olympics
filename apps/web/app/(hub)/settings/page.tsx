import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { members } from "@baumy/db/schema";
import { Card, FormMessage, MemberCharacter, PageHeading } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { listAvatars } from "@baumy/db/avatars";
import { avatarImageView } from "@/lib/avatars/paths";
import { ReportSettingsCard } from "@/components/feedback/report-settings-card";
import { reportAiAvailable } from "@/lib/feedback/ai";
import { filingState } from "@/lib/feedback/config";
import { githubIssues } from "@/lib/integrations/github";
import { isTestMode } from "@/lib/test-mode";
import { showsGalleryForm } from "@/lib/avatars/settings-card";
import { telegramBotUsername } from "@/lib/telegram/deep-link";
import { GalleryForm } from "./gallery-form";
import { KioskPinForm, TelegramLinkForm } from "./settings-forms";

// /settings (SPEC §6.2): the member's own character (a pick from the
// avatar gallery, issue #111), kiosk PIN and Telegram link. Every
// action here needs the member's own session (requireSession), never the
// kiosk. Also the bug reporter's card (issue #133) and, for admins, the
// way to System status.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireMemberPage();
  const db = createHttpDb() as unknown as Queryable;
  // Three independent reads, side by side (issue #128).
  const [[row], telegram, gallery] = await Promise.all([
    db
      .select({
        kioskPinHash: members.kioskPinHash,
        kioskPinLockedAt: members.kioskPinLockedAt,
        avatarImageId: members.avatarImageId,
        color: members.color,
      })
      .from(members)
      .where(eq(members.id, me.memberId)),
    uiRequestCtx(undefined).then((ctx) =>
      runAction("get_telegram_link_status", {}, ctx!),
    ),
    // The gallery (issue #111): once it has characters, "Your character" is
    // a pick from it; until then, and until they pick, they show as their
    // initial in their colour (issue #116).
    listAvatars(db, HOUSEHOLD_ID),
  ]);
  const { show, live, worn } = showsGalleryForm(gallery, row?.avatarImageId);
  const colour = row?.color ?? "var(--color-bm-muted)";
  const tracker = githubIssues();

  return (
    <>
      <PageHeading
        title="Settings"
        description="Your character, your sign-in security, your personal PIN, your Telegram link and your connected apps."
      />
      <div className="flex max-w-xl flex-col gap-6">
        {row?.kioskPinLockedAt ? (
          <FormMessage tone="error">
            Your personal PIN is locked after too many wrong tries. Set a new
            PIN below to unlock it.
          </FormMessage>
        ) : null}
        {show ? (
          <GalleryForm
            displayName={me.displayName}
            colour={colour}
            options={live.map((a) => ({
              id: a.id,
              name: a.name,
              sprites: avatarImageView(a)!,
            }))}
            picked={row?.avatarImageId ?? ""}
            archivedName={worn?.archivedAt ? worn.name : undefined}
          />
        ) : (
          <Card
            title="Your character"
            description="How you look on the kitchen screen and in the header."
          >
            <div
              id="character"
              className="flex items-center gap-4"
              data-testid="no-gallery"
            >
              <MemberCharacter
                name={me.displayName}
                colour={colour}
                scale={3}
                label={`${me.displayName}'s initial`}
              />
              <p className="text-sm text-bm-muted">
                The household has no characters to pick from yet. Until an admin
                adds some, you show as your initial in your colour.
              </p>
            </div>
          </Card>
        )}
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
          linked={telegram.ok && telegram.data.linked}
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
        <ReportSettingsCard
          filing={filingState(process.env, isTestMode())}
          repo={tracker.ok ? tracker.repo : null}
          aiAvailable={reportAiAvailable()}
        />
        {me.role === "admin" ? (
          <Card
            title="System status"
            description="Whether each service Baumy relies on is set up and answering. Admins only."
          >
            <Link href="/settings/system" className="text-sm underline">
              Open system status
            </Link>
          </Card>
        ) : null}
      </div>
    </>
  );
}
