import type { FormAction } from "@/components/use-action-form";
import { fail, type ActionResult } from "@/lib/actions/result";

// A form action that sends its fields, plus the picked photo, to the upload
// route (app/api/uploads/completion-photo) instead of a server action. It
// fits `AttestedForm`, so on the kiosk a PIN prompt resends the same fields
// with the PIN, and the photo with them.

export const PHOTO_UPLOAD_URL = "/api/uploads/completion-photo";

const EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function photoUploadAction<T>(
  getPhoto: () => Blob | null,
  kiosk: boolean,
): FormAction<T> {
  return async (_prev, form) => {
    const photo = getPhoto();
    if (!photo) return fail("INVALID_INPUT", "Choose a photo first.");
    const body = new FormData();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") body.append(key, value);
    }
    body.set("image", photo, `photo.${EXT[photo.type] ?? "webp"}`);
    if (kiosk) body.set("surface", "kiosk");
    let res: Response;
    try {
      res = await fetch(PHOTO_UPLOAD_URL, { method: "POST", body });
    } catch {
      return fail(
        "UNAVAILABLE",
        "The photo could not be sent. Check the connection and try again.",
      );
    }
    try {
      return (await res.json()) as ActionResult<T>;
    } catch {
      return fail("INTERNAL", "The upload failed. Please try again.");
    }
  };
}
