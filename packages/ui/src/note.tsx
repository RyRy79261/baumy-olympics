import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// A sticky note in the pixel kit (SPEC §3.5; ADR 0005 §3, the Messages
// board). A note is a card with its title, who wrote it, its body (a
// MarkdownBody from the page) and its buttons. `color` is a name from
// NOTE_COLORS (packages/types) or null: the note's frame and a faint wash
// in the nearest kit accent, so people can tell notes apart.

const NOTE_TINTS: Record<string, string> = {
  yellow: "bg-bm-yellow/10 [--pf:var(--color-bm-yellow)]",
  pink: "bg-bm-pink/10 [--pf:var(--color-bm-pink)]",
  blue: "bg-bm-teal/10 [--pf:var(--color-bm-teal)]",
  green: "bg-bm-green/10 [--pf:var(--color-bm-green)]",
  orange: "bg-bm-amber/10 [--pf:var(--color-bm-amber)]",
  purple: "bg-bm-violet/10 [--pf:var(--color-bm-violet)]",
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
        "pixel-frame flex min-h-0 flex-col gap-2 p-3 text-bm-text",
        (color && NOTE_TINTS[color]) || "bg-bm-surface",
        className,
      )}
      {...props}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-xl leading-tight font-semibold text-bm-text [overflow-wrap:anywhere]">
          {title}
        </h3>
        {pinned ? (
          <span className="pixel-frame shrink-0 px-1.5 font-label text-xs font-bold text-bm-muted uppercase">
            Pinned
          </span>
        ) : null}
      </header>
      {children ? (
        <div
          className={cx(
            "min-h-0 text-lg text-bm-text",
            clamp && "max-h-24 overflow-hidden",
          )}
        >
          {children}
        </div>
      ) : null}
      {meta ? (
        <p className="font-label text-xs text-bm-muted uppercase">{meta}</p>
      ) : null}
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
