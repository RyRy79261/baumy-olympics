"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AVATAR_HEIGHTS,
  AVATAR_NAME_MAX,
  AVATAR_POSES,
  DEFAULT_AVATAR_HEIGHT,
  type AvatarPose,
  type AvatarSprites,
} from "@baumy/types";
import {
  Button,
  Card,
  ChoiceGroup,
  Field,
  FormMessage,
  Input,
  MemberCharacter,
  Select,
} from "@baumy/ui";
import {
  newRequestId,
  useActionForm,
  useReporting,
} from "@/components/use-action-form";
import type { PreviewAvatarData } from "@/lib/actions/avatars";
import type { ActionResult } from "@/lib/actions/result";
import { toast } from "@/lib/ui/toast";
import { archiveAvatarAction, restoreAvatarAction } from "./actions";

// /admin/avatars (issue #111): add one character SET. Choose one sheet with
// up to three poses side by side (idle, walk, emote, left to right), or one
// file per pose. The upload route cleans them, all at one scale, and this
// shows before (the files as chosen) and after (each figure 4×, with the
// pose it will be; change it, or skip one), plus the idle pose at the sizes
// the app draws it. Pick 48, 56 or 64 pixels tall, name it, save: the route
// cleans the same files again, stores the poses and runs add_avatar.
// Nothing is kept until Save.

const UPLOAD = "/api/uploads/avatar";

type Assigned = AvatarPose | "skip";

type Draft = {
  files: File[];
  /** The files as chosen, for "before". */
  before: string[];
  name: string;
  height: number;
  requestId: string;
  preview: PreviewAvatarData | null;
  poses: Assigned[];
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

/** The sizes the app draws a character at (MemberCharacter's scale). */
const APP_SIZES = [
  { scale: 1, label: "Header" },
  { scale: 2, label: "Kitchen bar" },
  { scale: 4, label: "Dashboard" },
  { scale: 7, label: "Reminder" },
] as const;

async function send(
  files: File[],
  fields: Record<string, string>,
): Promise<ActionResult<unknown>> {
  const form = new FormData();
  for (const f of files) form.append("image", f);
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

/** The idle figure and the others as a set MemberCharacter can draw. */
function spritesOf(d: Draft): AvatarSprites | null {
  if (!d.preview) return null;
  const of = (pose: AvatarPose) => {
    const n = d.poses.indexOf(pose);
    const f = n >= 0 ? d.preview!.figures[n] : undefined;
    return f ? { src: f.preview, width: f.width, height: f.height } : null;
  };
  const idle = of("idle");
  return idle ? { idle, walk: of("walk"), emote: of("emote") } : null;
}

export function AvatarUploader() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const patch = (p: Partial<Draft>) =>
    setDraft((d) => (d ? { ...d, ...p } : d));

  // Each clean() takes a ticket; an answer for an older ticket (another
  // file or height chosen since) is dropped, so it can never overwrite
  // the preview of what is on screen now.
  const ticket = useRef(0);
  async function clean(files: File[], height: number) {
    const mine = ++ticket.current;
    patch({ busy: true, error: null, height });
    const r = await send(files, { mode: "preview", height: String(height) });
    if (mine !== ticket.current) return;
    const preview = r.ok ? (r.data as PreviewAvatarData) : null;
    patch({
      busy: false,
      preview,
      poses: preview
        ? preview.figures.map((_, n) => AVATAR_POSES[n] ?? "skip")
        : [],
      error: r.ok ? null : r.message,
    });
  }

  function choose(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    for (const url of draft?.before ?? []) URL.revokeObjectURL(url);
    setDraft({
      files,
      before: files.map((f) => URL.createObjectURL(f)),
      name: nameFromFile(files[0]!.name),
      height: draft?.height ?? DEFAULT_AVATAR_HEIGHT,
      requestId: newRequestId(),
      preview: null,
      poses: [],
      error: null,
      busy: true,
    });
    void clean(files, draft?.height ?? DEFAULT_AVATAR_HEIGHT);
  }

  function discard() {
    for (const url of draft?.before ?? []) URL.revokeObjectURL(url);
    setDraft(null);
  }

  async function save(d: Draft) {
    patch({ busy: true, error: null });
    const r = await send(d.files, {
      mode: "save",
      name: d.name,
      height: String(d.height),
      poses: d.poses.join(","),
      requestId: d.requestId,
    });
    if (!r.ok) {
      patch({ busy: false, error: r.message });
      return;
    }
    discard();
    toast.success(`Added ${d.name} to the gallery.`);
    router.refresh();
  }

  const sprites = draft ? spritesOf(draft) : null;
  return (
    <Card
      title="Add a character"
      description="One image with up to three poses side by side (idle, walk, emote, left to right), or one image per pose. PNG, JPEG or WebP, 4 MB at most together. The background is removed, each pose trimmed and all of them sampled at one scale, with one palette of 24 colours."
    >
      <div className="flex flex-col gap-4">
        <Field id="avatar-files" label="Images">
          {(control) => (
            <input
              {...control}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={draft?.busy}
              className="text-sm"
              onChange={(e) => {
                choose(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          )}
        </Field>
        {draft ? (
          <div
            data-testid="avatar-draft"
            className="flex flex-col gap-4 border-t-2 border-bm-line pt-4"
          >
            <ChoiceGroup
              legend="Height"
              name="avatar-height"
              options={AVATAR_HEIGHTS.map((h) => ({
                value: String(h),
                label: `${h} px`,
              }))}
              value={String(draft.height)}
              onChange={(v) => void clean(draft.files, Number(v))}
              disabled={draft.busy}
            />
            <div className="flex flex-wrap items-end gap-4">
              {draft.before.map((url, n) => (
                <figure key={url} className="flex flex-col items-center gap-1">
                  <img
                    src={url}
                    alt={`${draft.name} before cleaning${draft.before.length > 1 ? ` (${n + 1})` : ""}`}
                    className="max-h-48 w-auto bg-bm-ink"
                  />
                  <figcaption className="text-xs text-bm-muted">
                    Before
                  </figcaption>
                </figure>
              ))}
            </div>
            {draft.preview ? (
              <div className="flex flex-wrap items-end gap-4">
                {draft.preview.figures.map((f, n) => (
                  <figure
                    key={n}
                    data-testid="avatar-figure"
                    className="flex flex-col items-center gap-2"
                  >
                    <img
                      src={f.preview}
                      alt={`${draft.name} after cleaning, figure ${n + 1}`}
                      width={f.width * 4}
                      height={f.height * 4}
                      className="pixel-frame bg-bm-ink"
                      style={{ imageRendering: "pixelated" }}
                    />
                    <figcaption className="text-xs text-bm-muted">
                      {f.width} × {f.height} px
                    </figcaption>
                    <Field id={`avatar-pose-${n}`} label={`Figure ${n + 1}`}>
                      {(control) => (
                        <Select
                          {...control}
                          value={draft.poses[n]}
                          disabled={draft.busy}
                          onChange={(e) => {
                            const poses = [...draft.poses];
                            poses[n] = e.target.value as Assigned;
                            patch({ poses });
                          }}
                        >
                          <option value="idle">Idle</option>
                          <option value="walk">Walk</option>
                          <option value="emote">Emote</option>
                          <option value="skip">Skip</option>
                        </Select>
                      )}
                    </Field>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="text-sm text-bm-muted">
                {draft.busy ? "Cleaning..." : "No preview"}
              </p>
            )}
            {sprites ? (
              <div
                data-testid="avatar-app-sizes"
                className="flex flex-wrap items-end gap-6 bg-bm-ink p-4"
              >
                {APP_SIZES.map(({ scale, label }) => (
                  <figure
                    key={label}
                    className="flex flex-col items-center gap-2"
                  >
                    <MemberCharacter sprites={sprites} scale={scale} />
                    <figcaption className="text-xs text-bm-muted">
                      {label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
            <Field id="avatar-name" label="Name">
              {(control) => (
                <Input
                  {...control}
                  value={draft.name}
                  maxLength={AVATAR_NAME_MAX}
                  onChange={(e) => patch({ name: e.target.value })}
                  disabled={draft.busy}
                />
              )}
            </Field>
            {draft.error ? (
              <FormMessage tone="error">{draft.error}</FormMessage>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={draft.busy || !sprites}
                onClick={() => void save(draft)}
              >
                {draft.busy && draft.preview ? "Saving..." : "Save to gallery"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={draft.busy}
                onClick={discard}
              >
                Discard
              </Button>
            </div>
          </div>
        ) : null}
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
  // The success toast is raised as the action returns: the tile then moves
  // between Gallery and Archived, which remounts this button.
  const { state, formAction, pending, requestId } = useActionForm(
    useReporting(archived ? restoreAvatarAction : archiveAvatarAction, (d) =>
      toast.success(
        d.archived
          ? `${d.name} is out of the gallery.`
          : `${d.name} is back in the gallery.`,
      ),
    ),
  );
  useEffect(() => {
    if (state && !state.ok) toast.error(state.message);
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
