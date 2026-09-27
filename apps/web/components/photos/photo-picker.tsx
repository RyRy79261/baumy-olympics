"use client";

import { useEffect, useId, useState } from "react";
import { FormMessage, ProofPhoto, buttonClass } from "@baumy/ui";
import { downscalePhoto } from "./downscale";

// Choose a proof photo (SPEC §6.5): the file is shrunk in the browser to
// 1280px WebP/JPEG as soon as it is picked, previewed, and handed to the
// caller as a Blob. The upload itself is the caller's form
// (`photoUploadAction`), so the photo survives a PIN prompt: React resets a
// form's inputs after its action, but not this component's state.

export function PhotoPicker({
  label = "Add a photo",
  kiosk = false,
  onPhoto,
}: {
  label?: string;
  kiosk?: boolean;
  onPhoto: (photo: Blob | null) => void;
}) {
  const id = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function pick(file: File | undefined) {
    setError(null);
    onPhoto(null);
    setPreview(null);
    if (!file) return;
    setBusy(true);
    try {
      const small = await downscalePhoto(file);
      onPhoto(small);
      setPreview(URL.createObjectURL(small));
    } catch {
      setError("That file could not be read as a photo. Try another.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={buttonClass("secondary", kiosk ? "kiosk" : "default")}
      >
        {busy ? "Preparing the photo…" : preview ? "Change photo" : label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        aria-label={label}
        className="sr-only"
        onChange={(e) => void pick(e.currentTarget.files?.[0])}
      />
      {preview ? <ProofPhoto src={preview} alt="The photo you chose" /> : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
