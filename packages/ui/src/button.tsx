import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

// NEUTRAL PLACEHOLDER. The pixel UI kit (issue #7) restyles every component in
// this package in one place; the pages only choose a variant. Touch targets
// are at least 44px (min-h-11) everywhere, 56px with `size="kiosk"`.

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "default" | "kiosk";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700",
  secondary:
    "border border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100",
  danger: "bg-red-700 text-white hover:bg-red-600",
  ghost: "text-neutral-900 underline-offset-4 hover:underline",
};

const SIZES: Record<ButtonSize, string> = {
  default: "min-h-11 min-w-11 px-4 text-sm",
  kiosk: "min-h-14 min-w-14 px-6 text-base",
};

/** The classes a button gets, for a link that must look like one. */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "default",
  className?: string,
): string {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded font-medium",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A button; `type` defaults to "button" so it never submits by accident. */
export function Button({
  variant = "primary",
  size = "default",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      {...props}
    />
  );
}
