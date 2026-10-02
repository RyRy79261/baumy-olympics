"use client";

// WHAT A REPORT ATTACHES, shown before it is attached (issue #133). Ported
// from camp-404 `apps/web/components/feedback/report-diagnostics.tsx`, in
// the pixel kit. One component, in the reporter and on the Settings card,
// because this is the text somebody consents to.
//
// It renders the REAL payload: `collectDiagnostics()` runs here, and the rows
// are the fields that would be sent. Nothing here transmits.

import { useEffect, useId, useState } from "react";
import { DIAGNOSTICS_LIMITS, type ReportDiagnostics } from "@baumy/types";
import { cx } from "@baumy/ui";
import { collectDiagnostics } from "@/lib/feedback/client-errors";

export interface ReportDiagnosticsPanelProps {
  /**
   * The snapshot to show. The dialog passes the one it took when the box was
   * ticked, because that exact object is what it sends. Omitted, the panel
   * takes its own on mount (the Settings card, where nothing is filed).
   */
  diagnostics?: ReportDiagnostics | null;
  /** Open on first render. The dialog opens it; the card starts closed. */
  defaultOpen?: boolean;
  title?: string;
  className?: string;
}

/** One snapshot per mount, in an effect: it reads `window`. */
function useOwnSnapshot(enabled: boolean): ReportDiagnostics | null {
  const [snapshot, setSnapshot] = useState<ReportDiagnostics | null>(null);
  useEffect(() => {
    if (enabled) setSnapshot(collectDiagnostics());
  }, [enabled]);
  return snapshot;
}

export function ReportDiagnosticsPanel({
  diagnostics,
  defaultOpen = false,
  title = "What this attaches",
  className,
}: ReportDiagnosticsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const own = useOwnSnapshot(diagnostics === undefined);
  const shown = diagnostics ?? own;
  const fields = shown?.environment ?? [];
  const errors = shown?.errors ?? [];
  const bodyId = useId();

  return (
    <div className={cx("pixel-frame bg-bm-ink", className)}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="font-label text-sm font-bold tracking-wide text-bm-text uppercase">
          {title}
        </span>
        <span className="font-label text-xs text-bm-muted uppercase">
          {fields.length} {fields.length === 1 ? "field" : "fields"}{" "}
          {open ? "▴" : "▾"}
        </span>
      </button>

      <div id={bodyId} hidden={!open} className="flex flex-col gap-2 px-3 pb-3">
        <p className="text-base text-bm-muted">
          This goes on a GitHub issue in the household&apos;s public tracker,
          readable by anyone. Your name and email are never attached: only what
          you write, these facts about this device, and your member id, which
          means nothing outside Baumy but lets an admin see who to ask.
        </p>

        {shown === null ? (
          <p className="text-base text-bm-muted">
            Reading them from this browser&hellip;
          </p>
        ) : (
          <dl className="flex flex-col gap-1 bg-bm-surface p-2 text-sm">
            {fields.map((field) => (
              <div key={field.label} className="flex gap-2">
                <dt className="w-20 shrink-0 font-bold">{field.label}</dt>
                {/* break-all: a user agent has no spaces to wrap on. */}
                <dd className="min-w-0 flex-1 font-mono break-all">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {shown !== null &&
          (errors.length === 0 ? (
            <p className="text-base">No recent errors on this page.</p>
          ) : (
            <>
              <ul
                aria-label="Recent errors"
                className="flex flex-col gap-1 bg-bm-surface p-2 font-mono text-sm"
              >
                {errors.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="break-all">
                    {e.source}: {e.message}
                    {e.route ? ` (at ${e.route})` : ""}
                  </li>
                ))}
              </ul>
              <p className="text-base text-bm-amber">
                {errors.length} recent{" "}
                {errors.length === 1 ? "error" : "errors"}{" "}
                {errors.length === 1 ? "is" : "are"} attached. The last{" "}
                {DIAGNOSTICS_LIMITS.errors} are kept, and they can quote
                whatever was on screen when they happened.
              </p>
            </>
          ))}

        <p className="text-sm text-bm-muted">
          Paths only, never the query string. Emails, phone and ID numbers in
          what you write are stripped before posting. That&apos;s pattern
          matching, not a guarantee: it cannot recognise a name, so don&apos;t
          type a housemate&apos;s name or details.
        </p>
      </div>
    </div>
  );
}
