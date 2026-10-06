"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A modal on the native <dialog> element: focus trapping, Escape and the
// backdrop come from the browser. It is the calm module of ADR 0005 §1: a
// square-bordered panel over a dimmed page. It is capped at the screen's
// height and scrolls inside itself, so a tall one (a big household's "Who
// did it?") never runs off a phone's screen out of reach. The API stays
// `open` + `onClose`.
//
// Three ways out, all of which close the <dialog> the way Escape does, so
// `onClose` hears each once (issue #174): Escape, the "Close" button in the
// panel's corner (56px, a kiosk target everywhere), and a tap on the dimmed
// page around it. The <dialog> element has no padding or border of its own,
// so only a tap on the backdrop has the dialog itself as its target; and
// the press must start there too, so a drag that begins in the panel (say,
// selecting an input's text) and ends outside it closes nothing. The close
// button comes last in the DOM, so the browser still focuses the panel's
// own first control when it opens.

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => {
    if (ref.current?.open) ref.current.close();
  };

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const outside =
          e.target === e.currentTarget && pressedOutside.current;
        pressedOutside.current = false;
        if (outside) close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-hidden border-0 bg-transparent p-0 text-bm-text backdrop:bg-[rgb(8_4_14/0.82)]"
    >
      <div className="relative flex max-h-[calc(100dvh-2rem)] flex-col border-4 border-bm-line bg-bm-surface">
        <div
          data-testid="dialog-panel"
          className="min-h-0 overflow-y-auto overscroll-contain p-6"
        >
          <h2 className="mb-4 flex min-h-10 items-center pr-16 font-display text-base leading-relaxed">
            {title}
          </h2>
          {children}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="pixel-frame absolute top-3 right-3 grid size-14 place-items-center bg-bm-raised font-display text-[22px] text-bm-text [--pf:var(--color-bm-line)] hover:bg-bm-line"
        >
          ×
        </button>
      </div>
    </dialog>
  );
}
