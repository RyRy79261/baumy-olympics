import type {
  ComponentPropsWithRef,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

// Controls sit sunk into the page: ink-dark, a stepped frame in the line
// colour, red when invalid, and the focus ring inside the frame.
const CONTROL =
  "pixel-frame block min-h-11 w-full bg-bm-ink px-3 font-body text-lg text-bm-text placeholder:text-bm-dim " +
  "aria-[invalid=true]:[--pf:var(--color-bm-red)] disabled:opacity-50";

/** A text input; `kiosk` makes it a 56px touch target with larger text. */
export function Input({
  className,
  kiosk = false,
  ...props
}: ComponentPropsWithRef<"input"> & { kiosk?: boolean }) {
  return (
    <input
      className={cx(CONTROL, kiosk && "min-h-14 text-xl", className)}
      {...props}
    />
  );
}

/** A multi-line text input; `kiosk` makes it larger for touch. */
export function Textarea({
  className,
  kiosk = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { kiosk?: boolean }) {
  return (
    <textarea
      className={cx(CONTROL, "min-h-20 py-2", kiosk && "text-xl", className)}
      {...props}
    />
  );
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
      <label
        htmlFor={id}
        className="font-label text-sm font-bold tracking-wide text-bm-text uppercase"
      >
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(errorId ? { "aria-invalid": true as const } : {}),
      })}
      {hint ? (
        <p id={hintId} className="text-base text-bm-muted">
          {hint}
        </p>
      ) : null}
      {errorId ? (
        <p id={errorId} className="text-base text-bm-red">
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
        "pixel-frame px-4 py-3 text-base",
        tone === "error"
          ? "bg-bm-red/10 text-bm-red [--pf:var(--color-bm-red)]"
          : "bg-bm-green/10 text-bm-green [--pf:var(--color-bm-green)]",
      )}
    >
      {children}
    </p>
  );
}

/**
 * A checkbox with its label and an optional hint, the whole row a 44px touch
 * target. `children` go under the hint (the MCP consent screen lists what a
 * scope allows there).
 */
export function Checkbox({
  id,
  label,
  hint,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "type"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-lg text-bm-text"
      >
        <input
          id={id}
          type="checkbox"
          aria-describedby={hintId}
          className="size-5 shrink-0 accent-bm-green"
          {...props}
        />
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="ml-8 text-base text-bm-muted">
          {hint}
        </p>
      ) : null}
      {children ? <div className="ml-8">{children}</div> : null}
    </div>
  );
}
