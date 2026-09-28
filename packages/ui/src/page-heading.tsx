import type { ReactNode } from "react";

// Every page starts with this (AGENTS.md "UI"), shape from camp-404
// `packages/ui/src/components/page-heading.tsx`: an optional eyebrow, the one
// h1, an optional description and right-aligned actions. The h1 is in the
// display font, the eyebrow a Silkscreen label.

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        {eyebrow ? (
          <p className="font-label text-sm font-bold tracking-wider text-bm-muted uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-xl leading-snug text-bm-text sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-lg text-bm-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A section's heading inside a page (the inbox's "Waiting on you"): a
 * Silkscreen label, quieter than the page's h1 and a Card's title.
 */
export function SectionHeading({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="mb-3 font-label text-base font-bold tracking-wider text-bm-muted uppercase"
    >
      {children}
    </h2>
  );
}
