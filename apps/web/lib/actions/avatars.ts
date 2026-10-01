import { z } from "zod";
import {
  findAvatar,
  insertAvatar,
  setAvatarArchived,
  setMemberAvatarImage,
} from "@baumy/db/avatars";
import {
  AvatarRef,
  ChooseAvatar,
  NewAvatar,
  PreviewAvatar,
  type AvatarSprites,
} from "@baumy/types";
import { cleanAvatarSet } from "@/lib/avatars/clean";
import { avatarImageView, avatarPathAvatarId } from "@/lib/avatars/paths";
import type { ActionCtx } from "./define";
import { defineAction } from "./define";
import { fail, type ActionFailure } from "./result";

// The avatar gallery (issue #111). The owner generates each character
// elsewhere and an admin uploads it; the app only cleans it. An upload goes
// through app/api/uploads/avatar, which hands the file to `preview_avatar`
// (the admin gate, then the cleaning) and, to keep it, stores the cleaned
// sprite and runs `add_avatar` with it in `ctx.avatarImage`. So no input
// can name an image, and every gallery action is admin-only on the UI.
//
// Members then pick one (`choose_avatar`, or on /join); two members may pick
// the same. Archiving takes a character out of the gallery but leaves it on
// whoever already wears it.

const NOT_IN_GALLERY = fail(
  "NOT_FOUND",
  "That character is not in the gallery.",
);
const ARCHIVED = fail(
  "AVATAR_ARCHIVED",
  "That character was taken out of the gallery. Pick another one.",
);

/** Whether a member may pick this character now: in the gallery, live. */
export async function pickableAvatar(
  ctx: ActionCtx,
  avatarId: string,
): Promise<ActionFailure | null> {
  const row = await findAvatar(ctx.db, ctx.householdId, avatarId);
  if (!row) return NOT_IN_GALLERY;
  return row.archivedAt ? ARCHIVED : null;
}

export interface ChooseAvatarData {
  memberId: string;
  avatarId: string | null;
  /** The set now worn, or null for none (their initial tile). */
  sprites: AvatarSprites | null;
}

export const chooseAvatar = defineAction({
  name: "choose_avatar",
  title: "Pick my character from the gallery",
  description:
    "Sets the signed-in member's own character to one from the household's gallery of pixel characters, or to none with null (they then show as their initial in their colour). Only from their own signed-in session.",
  consent: "Change your own character",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: ChooseAvatar,
  async execute(ctx, { avatarId }) {
    const memberId = ctx.actor.memberId!;
    let sprites: AvatarSprites | null = null;
    if (avatarId !== null) {
      const refused = await pickableAvatar(ctx, avatarId);
      if (refused) return refused;
      sprites = avatarImageView(
        await findAvatar(ctx.db, ctx.householdId, avatarId),
      );
    }
    if (!(await setMemberAvatarImage(ctx.db, memberId, avatarId))) {
      return fail("NOT_FOUND", "Your member profile was not found.");
    }
    const data: ChooseAvatarData = { memberId, avatarId, sprites };
    return {
      ok: true,
      data,
      audit: { entity: "member", entityId: memberId },
    };
  },
});

export interface PreviewFigure {
  /** The cleaned figure as a `data:image/png;base64,…` URL. */
  preview: string;
  width: number;
  height: number;
}

export interface PreviewAvatarData {
  /** The height asked for, in the sprites' own pixels. */
  height: number;
  /** Left to right on a sheet, or one per file in their order. */
  figures: PreviewFigure[];
}

export const PNG_DATA_URL = "data:image/png;base64,";

const UNREADABLE = {
  empty:
    "Nothing was left once the background was removed. Try an image with the character on a plain or checkerboard background.",
  noisy: "This image is too noisy to read as a sprite.",
  unreadable: "That file could not be read as a PNG, JPEG or WebP image.",
} as const;

export const previewAvatar = defineAction({
  name: "preview_avatar",
  title: "Clean an uploaded character set",
  description:
    "Cleans the files just uploaded to the avatar gallery (one sheet of up to three poses side by side, or one file per pose): background removed, figures found and trimmed, all sampled at one scale to the height asked for, one palette. Returns the figures without keeping them. Admins only, from the app's upload route.",
  consent: "Clean characters for the household's gallery",
  kind: "read",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  input: PreviewAvatar,
  async execute(ctx, { height }) {
    if (!ctx.avatarUpload || ctx.avatarUpload.files.length === 0) {
      return fail("AVATAR_IMAGE_MISSING", "Choose an image to upload first.");
    }
    const cleaned = await cleanAvatarSet(ctx.avatarUpload.files, { height });
    if (!cleaned.ok) {
      return fail("AVATAR_IMAGE_UNREADABLE", UNREADABLE[cleaned.reason]);
    }
    const data: PreviewAvatarData = {
      height,
      figures: cleaned.figures.map((f) => ({
        preview: PNG_DATA_URL + f.png.toString("base64"),
        width: f.width,
        height: f.height,
      })),
    };
    return { ok: true, data };
  },
});

export interface AddAvatarData {
  avatarId: string;
  name: string;
  sprites: AvatarSprites;
}

export const addAvatar = defineAction({
  name: "add_avatar",
  title: "Add a character to the gallery",
  description:
    "Adds the character set just uploaded and cleaned (its idle pose, and walk and emote if given) to the household's gallery, under a name. Admins only, from the app's upload route.",
  consent: "Add characters to the household's gallery",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  input: NewAvatar,
  async execute(ctx, { name }) {
    const stored = ctx.avatarImage;
    const idle = stored?.poses.idle;
    if (
      !stored ||
      !idle ||
      Object.values(stored.poses).some(
        (p) => avatarPathAvatarId(p.pathname) !== stored.avatarId,
      )
    ) {
      return fail(
        "AVATAR_IMAGE_MISSING",
        "Choose an image with the idle pose first.",
      );
    }
    const row = await insertAvatar(ctx.db, {
      id: stored.avatarId,
      householdId: ctx.householdId,
      name,
      createdBy: ctx.actor.memberId!,
      createdAt: ctx.now,
      poses: { ...stored.poses, idle },
    });
    if (!row) {
      return fail("INVALID_STATE", "That character is already in the gallery.");
    }
    const data: AddAvatarData = {
      avatarId: row.id,
      name,
      sprites: avatarImageView(row)!,
    };
    return {
      ok: true,
      data,
      audit: {
        entity: "avatar",
        entityId: row.id,
        payload: { name, poses: row.poses },
      },
    };
  },
});

export interface ArchiveAvatarData {
  avatarId: string;
  name: string;
  archived: boolean;
}

/** What archive_avatar and restore_avatar share, all but the name. */
function archiveFields(archived: boolean) {
  return {
    title: archived
      ? "Take a character out of the gallery"
      : "Put a character back in the gallery",
    description: archived
      ? "Archives a gallery character: nobody new can pick it, and whoever already wears it keeps it. Admins only."
      : "Restores an archived gallery character, so members can pick it again. Admins only.",
    consent: "Manage the household's character gallery",
    kind: "write" as const,
    risk: "safe" as const,
    surfaces: ["ui"] as const,
    requires: "admin" as const,
    input: AvatarRef,
    async execute(ctx: ActionCtx, { avatarId }: z.output<typeof AvatarRef>) {
      const r = await setAvatarArchived(ctx.db, {
        householdId: ctx.householdId,
        avatarId,
        archived,
        now: ctx.now,
      });
      if (!r.ok) {
        return r.code === "NOT_FOUND"
          ? NOT_IN_GALLERY
          : fail(
              "INVALID_STATE",
              archived
                ? "That character is already archived. Refresh the page."
                : "That character is already in the gallery. Refresh the page.",
            );
      }
      const data: ArchiveAvatarData = { avatarId, name: r.name, archived };
      return {
        ok: true as const,
        data,
        audit: { entity: "avatar", entityId: avatarId },
      };
    },
  };
}

export const archiveAvatar = defineAction({
  name: "archive_avatar",
  ...archiveFields(true),
});
export const restoreAvatar = defineAction({
  name: "restore_avatar",
  ...archiveFields(false),
});
