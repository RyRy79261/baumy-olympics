"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A modal on the native <dialog> element: focus trapping, Escape and the
// backdrop come from the browser. It is the calm module of ADR 0005 §1: a
// square-bordered panel over a dimmed page. It is capped at the screen's
// height and scrolls inside itself, so a tall one (a big household's "Who
// did it?") never runs off a phone's screen out of reach. The API stays
// `open` +
// `onClose`.

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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain border-4 border-bm-line bg-bm-surface p-6 text-bm-text backdrop:bg-[rgb(8_4_14/0.82)]"
    >
      <h2 className="mb-4 font-display text-base leading-relaxed">{title}</h2>
      {children}
    </dialog>
  );
}
