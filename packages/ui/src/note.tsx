import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// NEUTRAL PLACEHOLDER for a sticky note (SPEC §3.5; issue #7 draws the pixel
// version here). A note is a card with its title, who wrote it, its body (a
// MarkdownBody from the page) and its buttons. `color` is a name from
// NOTE_COLORS (packages/types) or null; here it is only a plain stripe so
// people can tell notes apart, and `data-color` carries it for the restyle.

const STRIPES: Record<string, string> = {
  yellow: "border-l-yellow-400",
  pink: "border-l-pink-400",
  blue: "border-l-sky-400",
  green: "border-l-green-500",
  orange: "border-l-orange-400",
  purple: "border-l-purple-400",
};

export function StickyNote({
  title,
  color,
  pinned = false,
  meta,
  actions,
  clamp = false,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "title" | "color"> & {
  title: string;
  color: string | null;
  pinned?: boolean;
  /** "By Ryan · changed 27 Sep", or similar. */
  meta?: ReactNode;
  /** The note's buttons (pin, edit, delete). */
  actions?: ReactNode;
  /** Clip a long body instead of growing (the hub's widget). */
  clamp?: boolean;
  children?: ReactNode;
}) {
  return (
    <article
      data-color={color ?? "none"}
      data-pinned={pinned ? "true" : "false"}
      className={cx(
        "flex min-h-0 flex-col gap-2 rounded border border-neutral-300 bg-white p-3",
        color ? cx("border-l-8", STRIPES[color]) : null,
        className,
      )}
      {...props}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-neutral-900 [overflow-wrap:anywhere]">
          {title}
        </h3>
        {pinned ? (
          <span className="shrink-0 rounded border border-neutral-400 px-1.5 text-xs text-neutral-700">
            Pinned
          </span>
        ) : null}
      </header>
      {children ? (
        <div
          className={cx(
            "min-h-0 text-neutral-800",
            clamp && "max-h-24 overflow-hidden",
          )}
        >
          {children}
        </div>
      ) : null}
      {meta ? <p className="text-xs text-neutral-600">{meta}</p> : null}
      {actions ? (
        <div className="mt-auto flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </article>
  );
}

/** Notes side by side, as many columns as fit. */
export function NoteGrid({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
