"use client";

import {
  useEffect,
  useRef,
  type FormEvent,
  type PointerEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";

// What the kit's Dialog and the kiosk's KioskModal share (issue #174): a
// native <dialog> shown as a modal while `open`, and the ways out of it.
//
// - Every way out (Escape, a close button, a tap outside) closes the
//   <dialog> itself, and `onClose` hears the dialog's own `close` event, so
//   it is called once. When the caller shuts it (`open` goes false), it is
//   not called at all: the caller already knows. React passes `close` and `cancel` up through the
//   component tree, so a dialog inside another one would otherwise close
//   its parent too: only the event whose target is this dialog counts.
// - A tap outside is a press AND a click on the dialog element itself (its
//   ::backdrop, since the element has no padding or border of its own), so a
//   drag that starts in the panel and ends outside closes nothing.
// - Owner ruling 2026-10-06 (SPEC §12): once something was typed in it, a
//   tap outside does nothing; the close button, Cancel and Escape still
//   close it. Typed means a text field the user typed in, since it opened.
// - While `busy` (a request on its way), nothing closes it: the close button
//   is the caller's to disable, Escape is refused, and a tap outside is
//   ignored, so the form that sent the request is still there to show the
//   answer.

/** Fields whose input is typed text: not a choice, a file or a slider. */
const NOT_TYPED = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether an `input` event came from typing text. */
export function isTypedInput(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NOT_TYPED.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

export function useModalDialog({
  open,
  onClose,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const typed = useRef(false);
  const wanted = useRef(open);
  wanted.current = open;
  const busyNow = useRef(busy);
  busyNow.current = busy;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      typed.current = false;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /** Close it the way Escape does; never while busy. */
  function close() {
    if (busyNow.current) return;
    if (ref.current?.open) ref.current.close();
  }

  const own = (e: SyntheticEvent) => e.target === e.currentTarget;

  const dialogProps = {
    ref,
    onClose: (e: SyntheticEvent<HTMLDialogElement>) => {
      // The caller shut it (`open` went false): it already knows.
      if (!own(e) || !wanted.current) return;
      // A browser may close it anyway after a second Escape: while busy and
      // still wanted, it comes straight back.
      if (busyNow.current && wanted.current) {
        e.currentTarget.showModal();
        return;
      }
      onClose();
    },
    onCancel: (e: SyntheticEvent<HTMLDialogElement>) => {
      if (own(e) && busyNow.current) e.preventDefault();
    },
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      pressedOutside.current = own(e);
    },
    onClick: (e: MouseEvent<HTMLDialogElement>) => {
      const outside = own(e) && pressedOutside.current;
      pressedOutside.current = false;
      if (outside && !typed.current) close();
    },
    onInput: (e: FormEvent<HTMLDialogElement>) => {
      // Typing in a dialog opened from this one is that dialog's.
      const field = e.target as Element;
      if (field.closest?.("dialog") !== e.currentTarget) return;
      if (isTypedInput(e.target)) typed.current = true;
    },
  };

  return { ref, close, dialogProps };
}
