import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cx } from "./cx";

// NEUTRAL PLACEHOLDERS for the shopping list (SPEC §3.4; issue #7 restyles
// them here): a list of big rows, each one tap to tick off. The row is a
// submit button, so the page puts each in a form that sends the item. At
// least 44px tall, 56px with `kiosk`, and nothing depends on hover.

export function CheckList({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cx("flex flex-col gap-2", className)} {...props}>
      {children}
    </ul>
  );
}

/** One item: its name and an empty box; tapping it checks it off. */
export function CheckItemButton({
  label,
  kiosk = false,
  className,
  type = "submit",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  kiosk?: boolean;
}) {
  return (
    <button
      type={type}
      aria-label={`Check off ${label}`}
      className={cx(
        "flex w-full items-center gap-3 rounded border border-neutral-300 bg-white px-3 text-left text-neutral-900",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        kiosk ? "min-h-14 text-lg" : "min-h-11 text-base",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cx(
          "shrink-0 rounded-sm border-2 border-neutral-700",
          kiosk ? "size-7" : "size-5",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
