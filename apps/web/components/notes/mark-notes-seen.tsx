"use client";

import { useEffect, useRef } from "react";
import { newRequestId } from "@/components/use-action-form";

// Marks notes seen once they are on screen (issue #153): the Board on the
// phone and the kiosk, and the kitchen screen's Messages module. It sends
// `acknowledge_note` once per set of ids, after the notes have rendered, so
// a prefetch or a page that never showed them marks nothing. A failure is
// left alone: the notes stay unseen, and the next visit tries again.

export type SeenAction = (form: FormData) => Promise<unknown>;

/** The form `acknowledge_note` reads: each id, and a fresh request id. */
export function seenForm(noteIds: readonly string[]): FormData {
  const form = new FormData();
  for (const id of noteIds) form.append("noteIds", id);
  form.set("requestId", newRequestId());
  return form;
}

export function MarkNotesSeen({
  noteIds,
  action,
}: {
  /** The notes on screen that this member has not seen yet. */
  noteIds: readonly string[];
  action: SeenAction;
}) {
  const key = noteIds.join(",");
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (key === "" || sent.current === key) return;
    sent.current = key;
    action(seenForm(key.split(","))).catch(() => {
      // Offline for a moment: they stay unseen until the next visit.
    });
  }, [key, action]);
  return null;
}
