"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A modal on the native <dialog> element: focus trapping, Escape and the
// backdrop come from the browser. Issue #7 decides whether small screens get
// a bottom sheet instead; the API stays `open` + `onClose`.

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
      className="m-auto w-full max-w-md rounded border border-neutral-400 bg-white p-6 text-neutral-900 backdrop:bg-black/40"
    >
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </dialog>
  );
}
