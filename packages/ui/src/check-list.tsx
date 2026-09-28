import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cx } from "./cx";

// The shopping list in the pixel kit (SPEC §3.4; ADR 0005): a list of big
// rows, each one tap to tick off. The row is a
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
        "pixel-frame flex w-full items-center gap-3 bg-bm-surface px-3 text-left text-bm-text",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        kiosk ? "min-h-14 text-2xl" : "min-h-11 text-xl",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cx(
          "shrink-0 border-[3px] border-bm-amber bg-bm-ink",
          kiosk ? "size-7" : "size-5",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
