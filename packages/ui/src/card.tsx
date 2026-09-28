import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** A pixel-framed panel. With `title`, it is labelled by its own heading. */
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
        "pixel-frame pixel-frame-4 bg-bm-surface p-4 text-bm-text sm:p-6",
        className,
      )}
      {...props}
    >
      {title ? (
        <h2 className="mb-2 font-display text-sm leading-relaxed text-bm-text">
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="mb-4 text-base text-bm-muted">{description}</p>
      ) : null}
      {children}
    </section>
  );
}
