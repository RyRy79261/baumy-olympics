"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A modal on the native <dialog> element: focus trapping, Escape and the
// backdrop come from the browser. It is the calm module of ADR 0005 §1: a
// square-bordered panel over a dimmed page. It scrolls when tall, so it
// has a plain border, not the clip-path pixel frame: Chromium hit-tests a
// scrolled clip-path box wrongly, and taps then miss. The API stays `open` +
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
      className="m-auto w-full max-w-md border-4 border-bm-line bg-bm-surface p-6 text-bm-text backdrop:bg-[rgb(8_4_14/0.82)]"
    >
      <h2 className="mb-4 font-display text-base leading-relaxed">{title}</h2>
      {children}
    </dialog>
  );
}
