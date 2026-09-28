import type { ReactNode } from "react";
import { cx } from "@baumy/ui";

/** A small Silkscreen tag in a card title: green when on, quiet when off. */
export function StatusTag({
  on,
  children,
}: {
  on: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "pixel-frame px-2 py-1 font-label text-xs font-bold tracking-wider uppercase",
        on
          ? "bg-bm-green/10 text-bm-green [--pf:var(--color-bm-green)]"
          : "text-bm-muted",
      )}
    >
      {children}
    </span>
  );
}
