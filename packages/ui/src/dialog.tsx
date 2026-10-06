"use client";

import type { ReactNode } from "react";
import { useModalDialog } from "./use-modal-dialog";

// A modal on the native <dialog> element: focus trapping, Escape and the
// backdrop come from the browser. It is the calm module of ADR 0005 §1: a
// square-bordered panel over a dimmed page. It is capped at the screen's
// height and its body scrolls inside itself, so a tall one (a big
// household's "Who did it?") never runs off a phone's screen out of reach.
// The API stays `open` + `onClose`.
//
// The ways out (issue #174, use-modal-dialog.ts): Escape, the "Close" button
// in the header's corner (56px, a kiosk target everywhere), and a tap on the
// dimmed page around it, unless something was typed in it (owner ruling
// 2026-10-06). The header does not scroll, so the button never covers the
// body. It comes last in the DOM, so the browser still focuses the panel's
// own first control when it opens. While `busy` (its form is sending),
// nothing closes it and the button is disabled.

export function Dialog({
  open,
  onClose,
  title,
  busy = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A request is on its way: keep it open until the answer is shown. */
  busy?: boolean;
  children: ReactNode;
}) {
  const { close, dialogProps } = useModalDialog({ open, onClose, busy });

  return (
    <dialog
      {...dialogProps}
      aria-label={title}
      className="m-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-hidden border-0 bg-transparent p-0 text-bm-text backdrop:bg-[rgb(8_4_14/0.82)]"
    >
      <div className="relative flex max-h-[calc(100dvh-2rem)] flex-col border-4 border-bm-line bg-bm-surface">
        <div
          data-testid="dialog-header"
          className="flex min-h-20 shrink-0 items-center py-3 pr-20 pl-6"
        >
          <h2 className="font-display text-base leading-relaxed">{title}</h2>
        </div>
        <div
          data-testid="dialog-panel"
          className="min-h-0 overflow-y-auto overscroll-contain px-6 pt-1 pb-6"
        >
          {children}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          disabled={busy}
          className="pixel-frame absolute top-3 right-3 grid size-14 place-items-center bg-bm-raised font-display text-[22px] text-bm-text [--pf:var(--color-bm-line)] hover:bg-bm-line disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      </div>
    </dialog>
  );
}
