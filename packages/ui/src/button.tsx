import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

// The pixel kit's button (ADR 0005 §7): a stepped pixel frame, Silkscreen
// capitals, and a hard 1px press. Pages only choose a variant. Touch targets
// are at least 44px (min-h-11) everywhere, 56px with `size="kiosk"`.
//
//   primary    green, the one "go" per form
//   secondary  outlined in the text colour, on the raised surface
//   danger     red, for what cannot be undone
//   ghost      a quiet underlined link-button

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "default" | "kiosk";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "pixel-frame bg-bm-green text-bm-ink [--pf:var(--color-bm-ink)] hover:brightness-110",
  secondary:
    "pixel-frame bg-bm-raised text-bm-text [--pf:var(--color-bm-text)] hover:bg-bm-line",
  danger:
    "pixel-frame bg-bm-red text-bm-ink [--pf:var(--color-bm-ink)] hover:brightness-110",
  ghost: "text-bm-muted underline-offset-4 hover:text-bm-text hover:underline",
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
    "inline-flex items-center justify-center gap-2 font-label font-bold tracking-wide uppercase",
    "active:translate-y-px",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
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
