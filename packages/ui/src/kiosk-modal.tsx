"use client";

import { useEffect, useRef, type ReactNode } from "react";

// The kitchen dashboard's module sheet (ADR 0005 §1), on the native
// <dialog> like the kit's Dialog: focus trapping and Escape come from the
// browser, and the kiosk's auto-refresh and idle reset see it open. Unlike
// Dialog it is the whole screen: the page dims behind it, the ModulePanel
// hangs 120px from the top, and a tap on the dimmed part closes it.

export function KioskModal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The id of the panel's heading. */
  labelledBy: string;
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
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => {
        // The dialog itself is only the dimmed margin around the panel.
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent px-6 pt-[120px] text-bm-text backdrop:bg-[rgb(8_4_14/0.82)]"
    >
      {open ? (
        <div className="motion-safe:animate-pixel-in">{children}</div>
      ) : null}
    </dialog>
  );
}
