import { isFounderEmail } from "@baumy/auth/env";
import { createHttpDb, type Queryable } from "@baumy/db";
import { findAvatarPathname } from "@baumy/db/avatars";
import { findCompletionPhoto } from "@baumy/db/confirmations";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { getActor } from "@/lib/auth";
import { blobStore } from "@/lib/photos/blob-store";
import { handleBlobProxy } from "@/lib/photos/proxy";

// The only way to see a completion photo (SPEC §6.5) or a gallery sprite
// (issue #111): the checks are in lib/photos/proxy.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return handleBlobProxy(req, {
    getActor,
    mayJoinAsFounder: (actor) =>
      actor.kind === "member" &&
      actor.emailVerified &&
      isFounderEmail(process.env, actor.email),
    householdId: HOUSEHOLD_ID,
    findPhoto: (householdId, completionId) =>
      findCompletionPhoto(
        createHttpDb() as unknown as Queryable,
        householdId,
        completionId,
      ),
    findAvatar: (householdId, avatarId, pathname) =>
      findAvatarPathname(
        createHttpDb() as unknown as Queryable,
        householdId,
        avatarId,
        pathname,
      ),
    store: blobStore(),
  });
}
