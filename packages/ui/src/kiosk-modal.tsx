"use client";

import type { ReactNode } from "react";
import { useModalDialog } from "./use-modal-dialog";

// The kitchen dashboard's module sheet (ADR 0005 §1), on the native
// <dialog> like the kit's Dialog: focus trapping and Escape come from the
// browser, and the kiosk's auto-refresh and idle reset see it open. Unlike
// Dialog it is the whole screen: the page dims behind it, the ModulePanel
// hangs 120px from the top, and a tap on the dimmed part closes it, with
// the same press check as Dialog (use-modal-dialog.ts).

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
  const { dialogProps } = useModalDialog({ open, onClose });

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={labelledBy}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent px-6 pt-[120px] text-bm-text backdrop:bg-[rgb(8_4_14/0.82)]"
    >
      {open ? (
        <div className="motion-safe:animate-pixel-in">{children}</div>
      ) : null}
    </dialog>
  );
}
