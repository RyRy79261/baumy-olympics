"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A modal on the native <dialog> element: focus trapping, Escape and the
// backdrop come from the browser. It is the calm module of ADR 0005 §1: a
// pixel-framed panel over a dimmed page, rising into place (motion-safe);
// on a phone it is a sheet along the bottom edge. The API stays `open` +
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
      className="pixel-frame pixel-frame-4 m-auto w-full max-w-md bg-bm-surface p-6 text-bm-text backdrop:bg-[rgb(8_4_14/0.82)] motion-safe:open:animate-pixel-in max-sm:mb-0 max-sm:max-w-none"
    >
      <h2 className="mb-4 font-display text-base leading-relaxed">{title}</h2>
      {children}
    </dialog>
  );
}
