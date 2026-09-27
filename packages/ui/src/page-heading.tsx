import type { ReactNode } from "react";

// Every page starts with this (AGENTS.md "UI"), shape from camp-404
// `packages/ui/src/components/page-heading.tsx`: an optional eyebrow, the one
// h1, an optional description and right-aligned actions.

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
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <p className="text-xs uppercase tracking-widest text-neutral-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-neutral-600">{description}</p>
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
