"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  Field,
  FormMessage,
  Input,
  MarkdownBody,
  NoteGrid,
  PinPad,
  Select,
  StickyNote,
  Textarea,
} from "@baumy/ui";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX } from "@baumy/types";
import { AttestedForm } from "@/components/kiosk/attested-form";
import {
  useActionForm,
  useReporting,
  type FormAction,
} from "@/components/use-action-form";
import type {
  DeleteNoteData,
  NoteView,
  NoteWriteData,
} from "@/lib/actions/notes";
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";
import { NOTE_COLOR_OPTIONS, noteMeta } from "@/lib/notes/view";
import { toast, toastActionError } from "@/lib/ui/toast";

// The household's notes (SPEC §3.5), the same on the phone (/notes) and on
// the kiosk (/kiosk/notes, acting as the member whose avatar was tapped).
// Each note is a sticky note with its markdown body, rendered ONLY through
// MarkdownBody, the sanitising renderer. On the kiosk every change asks for
// the acting member's PIN in the request that makes it; on a phone the
// session vouches and no pad opens.
//
// Layout only: the look is the pixel kit's (packages/ui, issue #64).

export interface NoteActions {
  create: FormAction<NoteWriteData>;
  update: FormAction<NoteWriteData>;
  pin: FormAction<NoteWriteData>;
  remove: FormAction<DeleteNoteData>;
}

type Sheet = { mode: "new" } | { mode: "edit"; note: NoteView };

export function NoteBoard({
  notes,
  kiosk = false,
  canEdit,
  pinLabel,
  actions,
}: {
  notes: NoteView[];
  kiosk?: boolean;
  /** False on the kiosk until someone taps their avatar. */
  canEdit: boolean;
  /** What the PIN pad is for, e.g. "Ryan's PIN". */
  pinLabel: string;
  actions: NoteActions;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [deleting, setDeleting] = useState<NoteView | null>(null);
  const size = kiosk ? "kiosk" : "default";

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div>
          <Button size={size} onClick={() => setSheet({ mode: "new" })}>
            New note
          </Button>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <p className="text-sm text-bm-muted">
          No notes yet. Add one for the plumber, the bins or the guest wifi.
        </p>
      ) : (
        <NoteGrid data-testid="note-grid">
          {notes.map((n) => (
            <StickyNote
              key={n.id}
              data-testid={`note-${n.title}`}
              title={n.title}
              color={n.color}
              pinned={n.pinned}
              meta={noteMeta(n)}
              actions={
                canEdit ? (
                  <>
                    <PinForm
                      note={n}
                      action={actions.pin}
                      pinLabel={pinLabel}
                    />
                    <Button
                      variant="secondary"
                      size={size}
                      onClick={() => setSheet({ mode: "edit", note: n })}
                      aria-label={`Edit ${n.title}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      size={size}
                      onClick={() => setDeleting(n)}
                      aria-label={`Delete ${n.title}`}
                    >
                      Delete…
                    </Button>
                  </>
                ) : null
              }
            >
              {n.bodyMd ? <MarkdownBody>{n.bodyMd}</MarkdownBody> : null}
            </StickyNote>
          ))}
        </NoteGrid>
      )}

      <Dialog
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheet?.mode === "edit" ? `Edit ${sheet.note.title}` : "New note"}
      >
        {sheet ? (
          <NoteForm
            key={sheet.mode === "edit" ? sheet.note.id : "new"}
            note={sheet.mode === "edit" ? sheet.note : null}
            kiosk={kiosk}
            pinLabel={pinLabel}
            action={sheet.mode === "edit" ? actions.update : actions.create}
            onDone={(data) => {
              setSheet(null);
              toast.success(
                sheet.mode === "edit"
                  ? `Saved ${data.note.title}.`
                  : `Added ${data.note.title}.`,
              );
            }}
            onCancel={() => setSheet(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.title}?` : "Delete the note?"}
      >
        {deleting ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              This takes the note away for everyone in the house.
            </p>
            <AttestedForm
              key={deleting.id}
              action={actions.remove}
              label="Delete note"
              pinLabel={pinLabel}
              fields={<input type="hidden" name="noteId" value={deleting.id} />}
              onResult={(r) => {
                if (toastActionError(r)) return;
                if (r.ok) toast.success(`Deleted ${r.data.title}.`);
                setDeleting(null);
              }}
            />
            <Button
              variant="secondary"
              size="kiosk"
              onClick={() => setDeleting(null)}
            >
              Keep it
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/** Pin or unpin, one tap; on the kiosk the tap asks for the PIN. */
function PinForm({
  note,
  action,
  pinLabel,
}: {
  note: NoteView;
  action: FormAction<NoteWriteData>;
  pinLabel: string;
}) {
  return (
    <AttestedForm
      action={action}
      label={note.pinned ? "Unpin" : "Pin"}
      pinLabel={pinLabel}
      fields={
        <>
          <input type="hidden" name="noteId" value={note.id} />
          <input
            type="hidden"
            name="pinned"
            value={note.pinned ? "false" : "true"}
          />
        </>
      }
      onResult={(r) => {
        if (toastActionError(r)) return;
        if (r.ok) {
          toast.success(
            r.data.note.pinned
              ? `Pinned ${r.data.note.title} to the hub.`
              : `Unpinned ${r.data.note.title}.`,
          );
        }
      }}
    />
  );
}

/**
 * Add or edit a note. On the kiosk the first send goes without a PIN; when
 * the gate asks for one, the pad opens inside this form and its OK sends the
 * same fields again with the PIN (as AttestedForm does for one-tap forms).
 */
function NoteForm({
  note,
  kiosk,
  pinLabel,
  action,
  onDone,
  onCancel,
}: {
  note: NoteView | null;
  kiosk: boolean;
  pinLabel: string;
  action: FormAction<NoteWriteData>;
  onDone: (data: NoteWriteData) => void;
  onCancel: () => void;
}) {
  const { state, formAction, pending, requestId, errors } = useActionForm(
    useReporting(action, onDone),
  );
  const [attempt, setAttempt] = useState(0);
  // Controlled: React resets a form's uncontrolled fields after each action,
  // and a PIN prompt sends the same fields a second time.
  const [title, setTitle] = useState(note?.title ?? "");
  const [bodyMd, setBodyMd] = useState(note?.bodyMd ?? "");
  const [color, setColor] = useState<string>(note?.color ?? "none");
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const size = kiosk ? "kiosk" : "default";
  const id = note ? `note-${note.id}` : "note-new";
  const failed = state && !state.ok ? state : null;
  const needsPin = failed !== null && PIN_PROMPT_CODES.has(failed.code);
  const pinOpen = needsPin && !dismissed;
  return (
    <form
      action={(form) => {
        setDismissed(false);
        setAttempt((n) => n + 1);
        formAction(form);
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      {note ? <input type="hidden" name="noteId" value={note.id} /> : null}
      {/* Hidden, not the checkbox itself: a form reset does not touch it. */}
      {note ? null : (
        <input type="hidden" name="pinned" value={pinned ? "true" : "false"} />
      )}
      <Field id={`${id}-title`} label="Title" errors={errors.title}>
        {(c) => (
          <Input
            {...c}
            name="title"
            kiosk={kiosk}
            maxLength={NOTE_TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        )}
      </Field>
      <Field
        id={`${id}-body`}
        label="Note"
        hint="Markdown works: **bold**, *italic*, - lists and [links](https://…)."
        errors={errors.bodyMd}
      >
        {(c) => (
          <Textarea
            {...c}
            name="bodyMd"
            kiosk={kiosk}
            rows={5}
            maxLength={NOTE_BODY_MAX}
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
          />
        )}
      </Field>
      <Field id={`${id}-color`} label="Colour" errors={errors.color}>
        {(c) => (
          <Select
            {...c}
            name="color"
            className={kiosk ? "min-h-14 text-lg" : undefined}
            value={color}
            onChange={(e) => setColor(e.target.value)}
          >
            {NOTE_COLOR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {note ? null : (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"

            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className={kiosk ? "size-7" : "size-5"}
          />
          Pin it to the hub
        </label>
      )}
      {failed && !needsPin && failed.code !== "INVALID_INPUT" ? (
        <FormMessage tone="error">{failed.message}</FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size={size} disabled={pending}>
          {pending ? "Saving..." : note ? "Save" : "Add note"}
        </Button>
        <Button variant="secondary" size={size} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <Dialog
        open={pinOpen}
        onClose={() => setDismissed(true)}
        title={pinLabel}
      >
        <div className="flex flex-col gap-4">
          {failed && failed.code !== "ATTESTATION_REQUIRED" ? (
            <FormMessage tone="error">{failed.message}</FormMessage>
          ) : null}
          {pinOpen ? (
            <PinPad
              key={attempt}
              label={pinLabel}
              submitLabel="OK"
              pending={pending}
              onCancel={() => setDismissed(true)}
            />
          ) : null}
        </div>
      </Dialog>
    </form>
  );
}
