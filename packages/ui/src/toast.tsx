import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Toasts in the pixel kit (AGENTS.md "one-tap actions report through a
// toast"): a stack along the bottom of the screen, each a pixel-framed
// line, red-framed for an error. The app owns the store and the timing
// (components/toaster.tsx); these only look the part.

export function ToastList({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      className={cx(
        "pointer-events-none fixed inset-x-0 bottom-4 z-[70] mx-auto flex w-fit max-w-[92vw] flex-col items-center gap-2",
        className,
      )}
      {...props}
    >
      {children}
    </ol>
  );
}

export function ToastItem({
  variant,
  action,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, "children"> & {
  variant: "success" | "error" | "info";
  /** The dismiss button. */
  action?: ReactNode;
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
      {action}
    </li>
  );
}
