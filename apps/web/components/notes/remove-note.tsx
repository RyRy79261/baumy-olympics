"use client";

import { useRef, useState } from "react";
import { Button } from "@baumy/ui";
import { AttestedForm } from "@/components/kiosk/attested-form";
import type { FormAction } from "@/components/use-action-form";
import type { DeleteNoteData } from "@/lib/actions/notes";
import { toast, toastActionError } from "@/lib/ui/toast";

// The kitchen screen's "Remove" on a note (issue #194, SPEC §12 decision
// 37): one big button for the picked member, then "Remove this note?" in
// place, since it takes the note away for everyone. It runs `delete_note`
// as that member with no PIN (`member` on the kiosk, still audited); the
// form is an AttestedForm, so a PIN would be asked if the gate ever wanted
// one.

export function RemoveNote({
  note,
  action,
  pinLabel,
  onRemoved,
}: {
  note: { id: string; title: string };
  action: FormAction<DeleteNoteData>;
  /** What the PIN pad would be for, e.g. "Ryan's PIN". */
  pinLabel: string;
  /** Told once the note is gone. */
  onRemoved?: (noteId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const removed = useRef(onRemoved);
  removed.current = onRemoved;
  // The success is reported from the action itself: once the note is gone
  // the page re-renders without it, and this form unmounts before it could
  // see its own answer.
  const [remove] = useState(() => {
    const send: FormAction<DeleteNoteData> = async (prev, form) => {
      const r = await action(prev, form);
      if (r.ok) {
        toast.success(`Removed ${r.data.title}.`);
        removed.current?.(note.id);
      }
      return r;
    };
    return send;
  });
  if (!confirming) {
    return (
      <Button
        variant="secondary"
        size="kiosk"
        onClick={() => setConfirming(true)}
        aria-label={`Remove ${note.title}`}
      >
        Remove
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={`Remove ${note.title}?`}
      data-testid={`remove-note-${note.title}`}
      className="flex w-full flex-col gap-2"
    >
      <p className="font-label text-sm font-bold uppercase">
        Remove this note? It goes for everyone.
      </p>
      <AttestedForm
        action={remove}
        label="Remove"
        variant="danger"
        pinLabel={pinLabel}
        fields={<input type="hidden" name="noteId" value={note.id} />}
        onPending={setPending}
        onResult={(r) => {
          if (toastActionError(r)) return;
          setConfirming(false);
        }}
        bar={{
          className: "flex flex-wrap gap-2",
          extra: (
            <Button
              variant="secondary"
              size="kiosk"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
          ),
        }}
      />
    </div>
  );
}
