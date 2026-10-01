import type { Metadata } from "next";
import { createHttpDb, type Queryable } from "@baumy/db";
import { listAvatars, type AvatarRow } from "@baumy/db/avatars";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { Card, MemberCharacter, PageHeading } from "@baumy/ui";
import { requireAdminPage } from "@/lib/auth";
import { avatarImageView } from "@/lib/avatars/paths";
import { ArchiveAvatarButton, AvatarUploader } from "./avatar-forms";

// /admin/avatars (issue #111): the household's gallery of pre-generated
// pixel characters. Admins add them (cleaned on the way in), archive and
// restore them; everyone picks theirs in Settings or on /join. Anyone else
// gets a 404 from the page gate, and every write is an admin-only action.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avatars" };

function Tile({ a }: { a: AvatarRow }) {
  return (
    <li
      data-testid={`gallery-${a.name}`}
      className="pixel-frame flex flex-col items-center gap-2 bg-bm-ink p-3"
    >
      <MemberCharacter sprites={avatarImageView(a)} scale={4} label={a.name} />
      <span className="max-w-full text-center leading-tight font-label text-xs font-bold break-words uppercase">
        {a.name}
      </span>
      <span className="text-xs text-bm-muted">
        {a.wornBy === 0
          ? "Nobody wears it"
          : a.wornBy === 1
            ? "1 wears it"
            : `${a.wornBy} wear it`}
      </span>
      <ArchiveAvatarButton
        avatarId={a.id}
        name={a.name}
        archived={a.archivedAt !== null}
      />
    </li>
  );
}

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3";

export default async function AdminAvatarsPage() {
  await requireAdminPage();
  const gallery = await listAvatars(
    createHttpDb() as unknown as Queryable,
    HOUSEHOLD_ID,
  );
  const live = gallery.filter((a) => a.archivedAt === null);
  const archived = gallery.filter((a) => a.archivedAt !== null);

  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Avatars"
        description="The characters housemates pick from. Make them with the shared style prompt (docs/setup.md), then add them here."
      />
      <div className="flex flex-col gap-6">
        <AvatarUploader />
        <Card title="Gallery">
          {live.length === 0 ? (
            <p className="text-sm text-bm-muted">
              No characters yet. Until there are, everyone shows as their
              initial in their colour.
            </p>
          ) : (
            <ul className={GRID}>
              {live.map((a) => (
                <Tile key={a.id} a={a} />
              ))}
            </ul>
          )}
        </Card>
        {archived.length > 0 ? (
          <Card
            title="Archived"
            description="Out of the gallery; whoever already wears one keeps it."
          >
            <ul className={GRID}>
              {archived.map((a) => (
                <Tile key={a.id} a={a} />
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
