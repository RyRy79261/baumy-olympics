import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** A bordered section. With `title`, it is labelled by its own heading. */
export function Card({
  title,
  description,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section
      className={cx(
        "rounded border border-neutral-300 bg-white p-4 sm:p-6",
        className,
      )}
      {...props}
    >
      {title ? (
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">{title}</h2>
      ) : null}
      {description ? (
        <p className="mb-4 text-sm text-neutral-600">{description}</p>
      ) : null}
      {children}
    </section>
  );
}
