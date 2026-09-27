import { z } from "zod";
import { attachCompletionPhoto as attachPhoto } from "@baumy/db/confirmations";
import { photoPathCompletionId, photoProxyUrl } from "@/lib/photos/paths";
import { defineAction } from "./define";
import { fail } from "./result";

// Proof for a claim (SPEC §4.3, §6.5): the photo is stored by the upload
// route (app/api/uploads/completion-photo), which then runs this action with
// the stored pathname in `ctx.photo`. The input names the claim only, so no
// surface can attach a pathname it did not upload; that is why the action is
// offered on the UI and the kiosk only.
//
// A photo attached before the challenge window ends keeps a disputed claim
// from being voided when the window closes; after that it changes nothing.

export interface AttachPhotoData {
  completionId: string;
  choreName: string;
  /** Through the proxy; never the raw Blob URL. */
  photoUrl: string;
  photoAttachedAt: string;
}

export const attachCompletionPhoto = defineAction({
  name: "attach_completion_photo",
  title: "Add a photo to a chore",
  description:
    "Attaches the proof photo just uploaded to a chore claim you did or logged. Uploads go through the app's photo upload route.",
  consent: "Add proof photos to your chore claims",
  kind: "write",
  risk: "safe",
  surfaces: ["ui", "kiosk"],
  requires: "member",
  input: z.strictObject({
    completionId: z.uuid("Pick a claim."),
  }),
  async execute(ctx, i) {
    const photo = ctx.photo;
    if (
      !photo ||
      photo.completionId !== i.completionId ||
      photoPathCompletionId(photo.pathname) !== i.completionId
    ) {
      return fail("PHOTO_MISSING", "Choose a photo to upload first.");
    }
    const r = await attachPhoto(ctx.db, {
      householdId: ctx.householdId,
      completionId: i.completionId,
      actorId: ctx.actor.memberId!,
      pathname: photo.pathname,
      now: ctx.now,
    });
    if (!r.ok) {
      switch (r.code) {
        case "NOT_FOUND":
          return fail("NOT_FOUND", "That claim was not found.");
        case "FORBIDDEN":
          return fail(
            "FORBIDDEN",
            "Only the person who did it or logged it can add a photo.",
          );
        case "INVALID_STATE":
          return fail(
            "INVALID_STATE",
            "This claim was voided, so a photo would change nothing.",
          );
        case "PHOTO_ALREADY_ATTACHED":
          return fail(
            "PHOTO_ALREADY_ATTACHED",
            "This claim already has its photo.",
          );
        case "STALE":
          return fail(
            "INVALID_STATE",
            "Someone else just changed this claim. Refresh and look again.",
          );
      }
    }
    const data: AttachPhotoData = {
      completionId: r.completion.id,
      choreName: r.choreName,
      photoUrl: photoProxyUrl(r.completion.photoPathname!),
      photoAttachedAt: r.completion.photoAttachedAt!.toISOString(),
    };
    return {
      ok: true,
      data,
      audit: {
        entity: "completion",
        entityId: r.completion.id,
        payload: { completionId: i.completionId, pathname: photo.pathname },
      },
    };
  },
});
