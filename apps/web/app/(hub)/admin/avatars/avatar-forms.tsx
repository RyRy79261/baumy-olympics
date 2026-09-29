"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AVATAR_NAME_MAX } from "@baumy/types";
import { Button, Card, Field, FormMessage, Input } from "@baumy/ui";
import { newRequestId, useActionForm } from "@/components/use-action-form";
import type { PreviewAvatarData } from "@/lib/actions/avatars";
import type { ActionResult } from "@/lib/actions/result";
import { toast } from "@/lib/ui/toast";
import { archiveAvatarAction, restoreAvatarAction } from "./actions";

// /admin/avatars (issue #111): choose one or several images; each is sent to
// the upload route to be cleaned, and shows before (the file as chosen) and
// after (the cleaned sprite, 4× so its pixels show). Name it and save it:
// the route cleans the same file again, stores the sprite and runs
// add_avatar. Nothing is kept until Save.

const UPLOAD = "/api/uploads/avatar";

type Draft = {
  key: string;
  file: File;
  /** The file as chosen, for "before". */
  before: string;
  name: string;
  requestId: string;
  preview: PreviewAvatarData | null;
  error: string | null;
  busy: boolean;
};

/** "ryan-shades_v2.png" → "Ryan shades v2". */
export function nameFromFile(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  return name.slice(0, AVATAR_NAME_MAX);
}

async function send(
  file: File,
  fields: Record<string, string>,
): Promise<ActionResult<unknown>> {
  const form = new FormData();
  form.set("image", file);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    const res = await fetch(UPLOAD, { method: "POST", body: form });
    return (await res.json()) as ActionResult<unknown>;
  } catch {
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "The upload did not go through. Try again.",
    };
  }
}

export function AvatarUploader() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const patch = (key: string, p: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  async function choose(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const key = newRequestId();
      const draft: Draft = {
        key,
        file,
        before: URL.createObjectURL(file),
        name: nameFromFile(file.name),
        requestId: newRequestId(),
        preview: null,
        error: null,
        busy: true,
      };
      setDrafts((ds) => [...ds, draft]);
      const r = await send(file, { mode: "preview" });
      patch(key, {
        busy: false,
        preview: r.ok ? (r.data as PreviewAvatarData) : null,
        error: r.ok ? null : r.message,
      });
    }
  }

  async function save(d: Draft) {
    patch(d.key, { busy: true, error: null });
    const r = await send(d.file, {
      mode: "save",
      name: d.name,
      requestId: d.requestId,
    });
    if (!r.ok) {
      patch(d.key, { busy: false, error: r.message });
      return;
    }
    URL.revokeObjectURL(d.before);
    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
    toast.success(`Added ${d.name} to the gallery.`);
    router.refresh();
  }

  return (
    <Card
      title="Add characters"
      description="PNG, JPEG or WebP, 4 MB at most each. The background is removed, the character trimmed, snapped to a pixel grid about 56 pixels tall and limited to 24 colours."
    >
      <div className="flex flex-col gap-4">
        <Field id="avatar-files" label="Images">
          {(control) => (
            <input
              {...control}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="text-sm"
              onChange={(e) => {
                void choose(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          )}
        </Field>
        {drafts.map((d) => (
          <div
            key={d.key}
            data-testid="avatar-draft"
            className="flex flex-col gap-3 border-t-2 border-bm-line pt-4"
          >
            <div className="flex flex-wrap items-end gap-4">
              <figure className="flex flex-col items-center gap-1">
                {/* The file as chosen, before cleaning. */}
                <img
                  src={d.before}
                  alt={`${d.name} before cleaning`}
                  className="max-h-56 w-auto bg-bm-ink"
                />
                <figcaption className="text-xs text-bm-muted">
                  Before
                </figcaption>
              </figure>
              <figure className="flex flex-col items-center gap-1">
                {d.preview ? (
                  <img
                    src={d.preview.preview}
                    alt={`${d.name} after cleaning`}
                    width={d.preview.width * 4}
                    height={d.preview.height * 4}
                    className="pixel-frame bg-bm-ink"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <span className="text-sm text-bm-muted">
                    {d.busy ? "Cleaning..." : "No preview"}
                  </span>
                )}
                <figcaption className="text-xs text-bm-muted">
                  After
                  {d.preview
                    ? ` (${d.preview.width} × ${d.preview.height} px)`
                    : ""}
                </figcaption>
              </figure>
            </div>
            <Field id={`avatar-name-${d.key}`} label="Name">
              {(control) => (
                <Input
                  {...control}
                  value={d.name}
                  maxLength={AVATAR_NAME_MAX}
                  onChange={(e) => patch(d.key, { name: e.target.value })}
                  disabled={d.busy}
                />
              )}
            </Field>
            {d.error ? <FormMessage tone="error">{d.error}</FormMessage> : null}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={d.busy || !d.preview}
                onClick={() => void save(d)}
              >
                {d.busy && d.preview ? "Saving..." : "Save to gallery"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={d.busy}
                onClick={() => {
                  URL.revokeObjectURL(d.before);
                  setDrafts((ds) => ds.filter((x) => x.key !== d.key));
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Archive or restore one character: a one-tap action, told by a toast. */
export function ArchiveAvatarButton({
  avatarId,
  name,
  archived,
}: {
  avatarId: string;
  name: string;
  archived: boolean;
}) {
  const { state, formAction, pending, requestId } = useActionForm(
    archived ? restoreAvatarAction : archiveAvatarAction,
  );
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(
        state.data.archived
          ? `${state.data.name} is out of the gallery.`
          : `${state.data.name} is back in the gallery.`,
      );
    } else toast.error(state.message);
  }, [state]);
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="avatarId" value={avatarId} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={`${archived ? "Restore" : "Archive"} ${name}`}
      >
        {archived ? "Restore" : "Archive"}
      </Button>
    </form>
  );
}
