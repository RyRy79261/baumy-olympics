import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { cx } from "./cx";

const CONTROL =
  "block min-h-11 w-full rounded border border-neutral-400 bg-white px-3 text-base text-neutral-900 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900 " +
  "aria-[invalid=true]:border-red-700 disabled:opacity-50";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(CONTROL, className)} {...props} />;
}

/**
 * A label, its control, an optional hint and its errors. The control is
 * passed as a render function so it gets the ids that tie them together
 * (`aria-describedby`, `aria-invalid`).
 */
export function Field({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  errors?: readonly string[];
  children: (control: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
  }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors && errors.length > 0 ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-neutral-900">
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(errorId ? { "aria-invalid": true as const } : {}),
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-neutral-600">
          {hint}
        </p>
      ) : null}
      {errorId ? (
        <p id={errorId} className="text-sm text-red-700">
          {errors!.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/** A form-level message: an error (role=alert) or a success (role=status). */
export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded border px-3 py-2 text-sm",
        tone === "error"
          ? "border-red-700 bg-red-50 text-red-800"
          : "border-green-700 bg-green-50 text-green-800",
      )}
    >
      {children}
    </p>
  );
}
