"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
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
// own first control when it opens.
//
// Sending (SPEC §12 decision 32, issue #212): a form inside the sheet says
// it is sending with `useSheetSending(pending)` (or `<SheetSending>` when
// its pending lives above the sheet). The sheet hears it through context,
// with no wiring through its caller: while any form in it is sending,
// nothing closes it and the × is disabled. The caller's other ways out (a
// Cancel) and the choices that would start the form again ("Who did it?",
// the photo) read the same state from `children` given as a function,
// `(sending) => ...`, so no page keeps a copy of it. Text fields stay as
// they are. A form inside a pop-up opened from this one reports to that
// pop-up only.

type Report = (key: string, sending: boolean) => void;

const SheetSendingContext = createContext<Report | null>(null);

/**
 * Tell the sheet (Dialog) around this component that its form is sending,
 * so the sheet holds itself open and greys its × until the answer is in.
 * Told "not sending" when the component goes away. Outside a sheet it does
 * nothing.
 */
export function useSheetSending(sending: boolean): void {
  const report = useContext(SheetSendingContext);
  const key = useId();
  useEffect(() => {
    if (!report) return;
    report(key, sending);
    return () => report(key, false);
  }, [report, key, sending]);
}

/** `useSheetSending` for a form whose pending state lives above the sheet. */
export function SheetSending({ pending }: { pending: boolean }): null {
  useSheetSending(pending);
  return null;
}

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
  /**
   * Only for a sheet whose request is not a form inside it (Ask Baumy's
   * Confirm all): keeps it open like a sending form. A form inside uses
   * `useSheetSending` instead.
   */
  busy?: boolean;
  /** Or a function of whether a form in it is sending, to lock controls. */
  children: ReactNode | ((sending: boolean) => ReactNode);
}) {
  const [senders, setSenders] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback<Report>((key, on) => {
    setSenders((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const sending = senders.size > 0;
  const { close, dialogProps } = useModalDialog({
    open,
    onClose,
    busy: busy || sending,
  });

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
          <SheetSendingContext.Provider value={report}>
            {typeof children === "function" ? children(sending) : children}
          </SheetSendingContext.Provider>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          disabled={busy || sending}
          className="pixel-frame absolute top-3 right-3 grid size-14 place-items-center bg-bm-raised font-display text-[22px] text-bm-text [--pf:var(--color-bm-line)] hover:bg-bm-line disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      </div>
    </dialog>
  );
}
