"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "./button";
import { cx } from "./cx";
import { DIALOG_TYPED_EVENT } from "./use-modal-dialog";

// The kiosk PIN pad in the pixel kit (SPEC §6.2, §8; ADR 0005). It sits INSIDE the form of the request it attests and submits the PIN
// as a hidden field with that one request. It keeps the digits only until
// the form is sent: the page remounts it (a new `key`) after every attempt,
// and nothing is written to storage, so the next request needs the PIN
// typed again.
//
// Keys are 64px; the physical keyboard also works (digits and Backspace).

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

const KEY = buttonClass(
  "secondary",
  "kiosk",
  "min-h-16 font-display text-xl font-normal",
);

export function PinPad({
  label,
  name = "pin",
  submitLabel = "OK",
  pending = false,
  onCancel,
}: {
  /** What the pad is for, e.g. "Ryan's PIN". */
  label: string;
  /** The form field the PIN is sent in. */
  name?: string;
  submitLabel?: string;
  /** While the attempt is being checked: keys and submit are disabled. */
  pending?: boolean;
  /** Shows a Cancel button. */
  onCancel?: () => void;
}) {
  const [digits, setDigits] = useState("");
  const pad = useRef<HTMLDivElement>(null);
  // A half-typed PIN is typed text: a tap outside its dialog keeps it
  // (owner ruling 2026-10-06, SPEC §12 decision 32).
  useEffect(() => {
    if (digits === "") return;
    pad.current?.dispatchEvent(
      new Event(DIALOG_TYPED_EVENT, { bubbles: true }),
    );
  }, [digits]);

  const press = (d: string) =>
    setDigits((cur) => (cur.length >= PIN_MAX_LENGTH ? cur : cur + d));
  const back = () => setDigits((cur) => cur.slice(0, -1));

  useEffect(() => {
    if (pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div
      ref={pad}
      role="group"
      aria-label={label}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name={name} value={digits} />
      <p className="text-center font-display text-sm leading-relaxed">
        {label}
      </p>
      <output
        aria-live="polite"
        aria-label={`${digits.length} of ${PIN_MAX_LENGTH} digits entered`}
        data-testid="pin-dots"
        className="flex justify-center gap-3"
      >
        {Array.from({ length: PIN_MAX_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden
            data-filled={i < digits.length ? "true" : "false"}
            className={cx(
              "block size-5",
              i < digits.length
                ? "bg-bm-yellow"
                : "border-[3px] border-bm-muted bg-bm-ink",
              i >= PIN_MIN_LENGTH && "opacity-50",
            )}
          />
        ))}
      </output>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className={KEY}
            disabled={pending}
            onClick={() => press(k)}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          className={KEY}
          disabled={pending || digits.length === 0}
          onClick={() => setDigits("")}
        >
          Clear
        </button>
        <button
          type="button"
          className={KEY}
          disabled={pending}
          onClick={() => press("0")}
        >
          0
        </button>
        <button
          type="button"
          className={KEY}
          aria-label="Delete last digit"
          disabled={pending || digits.length === 0}
          onClick={back}
        >
          ⌫
        </button>
      </div>
      <div className="flex gap-2">
        {onCancel ? (
          <button
            type="button"
            className={buttonClass("secondary", "kiosk", "flex-1")}
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          className={buttonClass("primary", "kiosk", "min-h-16 flex-1")}
          disabled={pending || digits.length < PIN_MIN_LENGTH}
        >
          {pending ? "Checking..." : submitLabel}
        </button>
      </div>
    </div>
  );
}
