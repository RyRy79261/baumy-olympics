"use client";

import { useEffect, useState, useTransition } from "react";
import {
  REPORT_DESCRIPTION_MAX,
  type ReportBugInput,
  type ReportDiagnostics,
  type ReportKind,
} from "@baumy/types";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  FormMessage,
  Textarea,
} from "@baumy/ui";
import type { ReportBugData } from "@/lib/actions/report-bug";
import type { ActionResult } from "@/lib/actions/result";
import { collectDiagnostics } from "@/lib/feedback/client-errors";
import { newRequestId } from "@/components/use-action-form";
import { ReportDiagnosticsPanel } from "./report-diagnostics";

// The bug and feature reporter (issue #133). Ported from camp-404
// `apps/web/components/feedback/report-bug-dialog.tsx`, drawn in the pixel
// kit: the type, what went wrong, "Improve with AI" when Claude is set up,
// and the diagnostics the member can see before ticking them in. It sends
// through `report_bug` (lib/actions/report-bug.ts), which files a GitHub
// issue. Camp-404's voice dictation is left out for now.

export type SendReport = (
  input: Partial<ReportBugInput>,
  requestId: string,
) => Promise<ActionResult<ReportBugData>>;

export interface ReportBugDialogProps {
  open: boolean;
  onClose: () => void;
  send: SendReport;
  defaultKind?: ReportKind;
  /** Text the description starts with (an error page passes its trace). */
  defaultDescription?: string;
  /** Claude is set up here, so the AI pass can run. */
  aiAvailable?: boolean;
  /** The kitchen screen: 56px targets. */
  kiosk?: boolean;
  /**
   * Why nobody can send from here yet (the kiosk with nobody picked), shown
   * instead of the Send button. Null when they can.
   */
  blocked?: string | null;
}

export function ReportBugDialog({
  open,
  onClose,
  send,
  defaultKind = "bug",
  defaultDescription = "",
  aiAvailable = false,
  kiosk = false,
  blocked = null,
}: ReportBugDialogProps) {
  const [kind, setKind] = useState<ReportKind>(defaultKind);
  const [description, setDescription] = useState(defaultDescription);
  const [useAi, setUseAi] = useState(true);
  // Exactly what the attach box would send, taken when it is ticked. The
  // panel shows this object, and this object is sent.
  const [attached, setAttached] = useState<ReportDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<ReportBugData | null>(null);
  // One id per report, kept across retries of it: a retry is a replay.
  const [requestId, setRequestId] = useState(newRequestId);
  const [pending, startTransition] = useTransition();

  // A fresh form on each closed→open.
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind);
    setDescription(defaultDescription);
    setUseAi(true);
    setAttached(null);
    setError(null);
    setFiled(null);
    setRequestId(newRequestId());
  }, [open, defaultKind, defaultDescription]);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await send(
          {
            kind,
            description,
            useAi: aiAvailable && useAi,
            ...(attached ? { diagnostics: attached } : {}),
            route: window.location.pathname,
          },
          requestId,
        );
        if (result.ok) setFiled(result.data);
        else setError(result.message);
      } catch {
        // The action returns a result, but its transport can still reject.
        setError("Couldn't send your report just now. Please try again.");
      }
    });
  }

  const size = kiosk ? "kiosk" : "default";
  const canSend = !blocked && description.trim().length > 0 && !pending;

  if (filed) {
    return (
      <Dialog open={open} onClose={onClose} title="Report filed">
        <div className="flex flex-col gap-4" data-testid="report-filed">
          <FormMessage tone="success">
            Issue #{filed.number} is on the tracker. Thank you!
          </FormMessage>
          <a
            href={filed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base underline"
          >
            View issue #{filed.number}
          </a>
          <div className="flex justify-end">
            <Button size={size} onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={kind === "bug" ? "Report a bug" : "Request a feature"}
    >
      <form
        className="flex flex-col gap-4"
        data-testid="report-bug-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) submit();
        }}
      >
        <p className="text-base text-bm-muted">
          This opens an issue on our public GitHub tracker. Please don&apos;t
          include anyone&apos;s personal details.
        </p>

        <div role="group" aria-label="Report type" className="flex gap-2">
          {(
            [
              ["bug", "Bug"],
              ["feature", "Feature"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size={size}
              variant={kind === value ? "primary" : "secondary"}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className="flex-1"
            >
              {label}
            </Button>
          ))}
        </div>

        <Field
          id="report-description"
          label={kind === "bug" ? "What went wrong?" : "What would you like?"}
        >
          {(control) => (
            <Textarea
              {...control}
              kiosk={kiosk}
              rows={5}
              maxLength={REPORT_DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder={
                kind === "bug"
                  ? "What you did, what you expected, and what happened instead."
                  : "The thing you'd like Baumy to do."
              }
            />
          )}
        </Field>

        {aiAvailable ? (
          <Checkbox
            id="report-use-ai"
            label="Improve with AI"
            hint="Claude rewrites your report as a title and steps before filing."
            checked={useAi}
            onChange={(e) => setUseAi(e.currentTarget.checked)}
          />
        ) : null}

        <div className="flex flex-col gap-2">
          <Checkbox
            id="report-attach-diagnostics"
            label="Attach device details and recent errors"
            hint="Helps find the fault. You see everything that is sent below."
            checked={attached !== null}
            onChange={(e) =>
              setAttached(e.currentTarget.checked ? collectDiagnostics() : null)
            }
          />
          {attached ? (
            <ReportDiagnosticsPanel diagnostics={attached} defaultOpen />
          ) : null}
        </div>

        {blocked ? <FormMessage tone="error">{blocked}</FormMessage> : null}
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size={size}
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          {blocked ? null : (
            <Button size={size} type="submit" disabled={!canSend}>
              {pending ? "Sending…" : "Send report"}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
