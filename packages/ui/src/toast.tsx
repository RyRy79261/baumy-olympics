import type { HTMLAttributes, ReactNode } from "react";
import { buttonClass } from "./button";
import { cx } from "./cx";

// Toasts in the pixel kit (AGENTS.md "one-tap actions report through a
// toast"): a stack of pixel-framed lines, red-framed for an error. The app
// owns the store and the timing (components/toaster.tsx); these only look
// the part.
//
// Where they sit keeps them off the other stacks: on the hub along the
// bottom, above Baumy's plinth on a phone; on the kiosk (a page with
// [data-kiosk]) under the header, because the kiosk's own notice
// (KioskNotice) uses the bottom edge. There the Dismiss
// button is a 56px kiosk target.

export function ToastList({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      className={cx(
        "pointer-events-none fixed inset-x-0 bottom-4 z-[70] mx-auto flex w-fit max-w-[min(92vw,36rem)] flex-col items-center gap-2 max-sm:bottom-36",
        "[body:has([data-kiosk])_&]:top-24 [body:has([data-kiosk])_&]:bottom-auto",
        className,
      )}
      {...props}
    >
      {children}
    </ol>
  );
}

/** The Dismiss button's classes: 44px on the hub, 56px on the kiosk. */
export const toastDismissClass = buttonClass(
  "ghost",
  "default",
  "[body:has([data-kiosk])_&]:min-h-14 [body:has([data-kiosk])_&]:min-w-14 [body:has([data-kiosk])_&]:px-6 [body:has([data-kiosk])_&]:text-base",
);

export function ToastItem({
  variant,
  onDismiss,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, "children"> & {
  variant: "success" | "error" | "info";
  /** Shows a Dismiss button. */
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <li
      role={variant === "error" ? "alert" : "status"}
      data-variant={variant}
      className={cx(
        "pixel-frame pixel-frame-4 pointer-events-auto flex items-center gap-4 bg-bm-raised py-2 pr-2 pl-4 text-xl text-bm-text motion-safe:animate-pixel-in",
        variant === "error" && "[--pf:var(--color-bm-red)]",
        variant === "success" && "[--pf:var(--color-bm-green)]",
        variant === "info" && "[--pf:var(--color-bm-text)]",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss ? (
        <button type="button" className={toastDismissClass} onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </li>
  );
}
