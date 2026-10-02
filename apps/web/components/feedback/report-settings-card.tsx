"use client";

// "Bugs and feature requests" on /settings (issue #133). Ported from camp-404
// `apps/web/components/feedback/report-settings-card.tsx`, in the pixel kit.
//
// It answers the question you cannot ask by shaking a phone: what does this
// send? The same panel the reporter shows is here, closed, readable without
// filing anything. On an iPhone or iPad it also asks iOS for the motion
// events shake needs, from a tap, as iOS requires. Every claim below is read
// off the code that files the issue (lib/actions/report-bug.ts,
// lib/feedback/issue.ts, lib/feedback/client-errors.ts).

import { useEffect, useState } from "react";
import type { ReportKind } from "@baumy/types";
import { Button, Card, FormMessage } from "@baumy/ui";
import {
  FEEDBACK_UNAVAILABLE_MESSAGE,
  type FilingState,
} from "@/lib/feedback/config";
import { openReportProblem } from "./report-problem";
import { ReportDiagnosticsPanel } from "./report-diagnostics";
import {
  motionPermissionNeeded,
  rememberMotionAnswer,
  rememberedMotionAnswer,
  requestMotionPermission,
  type MotionPermission,
} from "./use-shake-gesture";

export interface ReportSettingsCardProps {
  /** Why a report has nowhere to go, or "ok". */
  filing: FilingState;
  /** `owner/name` of the tracker, when one is set. Never the token. */
  repo: string | null;
  aiAvailable: boolean;
}

/** Turn on shake, for the browsers that ask first (iOS). */
function ShakePermission() {
  const [needed, setNeeded] = useState(false);
  const [answer, setAnswer] = useState<MotionPermission | null>(null);
  useEffect(() => {
    setNeeded(motionPermissionNeeded());
    setAnswer(rememberedMotionAnswer());
  }, []);
  if (!needed) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="shake-permission">
      <p className="text-base text-bm-muted">
        {answer === "granted"
          ? "Shake to report is on for this device."
          : answer === "denied"
            ? "This device said no to motion. If shaking does nothing, allow motion for this site in its settings, then try again."
            : "This device asks before it lets a page feel a shake."}
      </p>
      {answer === "granted" ? null : (
        <Button
          variant="secondary"
          onClick={async () => {
            const result = await requestMotionPermission();
            rememberMotionAnswer(result);
            setAnswer(result);
          }}
        >
          Turn on shake to report
        </Button>
      )}
    </div>
  );
}

export function ReportSettingsCard({
  filing,
  repo,
  aiAvailable,
}: ReportSettingsCardProps) {
  const start = (kind: ReportKind) => openReportProblem({ kind });
  return (
    <Card
      title="Bugs and feature requests"
      description={
        filing === "ok"
          ? "Start one here, or shake your phone or the kitchen iPad on any screen."
          : "How reports work here, and what one would send."
      }
    >
      <div className="flex flex-col gap-4" data-testid="report-settings-card">
        {filing !== "ok" ? (
          <FormMessage tone="error">
            {FEEDBACK_UNAVAILABLE_MESSAGE[filing]}{" "}
            {filing === "bad_repo"
              ? "GITHUB_FEEDBACK_REPO must be owner/name."
              : "There is no GitHub token on this deployment."}
          </FormMessage>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => start("bug")}>Report a bug</Button>
            <Button variant="secondary" onClick={() => start("feature")}>
              Request a feature
            </Button>
          </div>
        )}

        <ShakePermission />

        <ReportDiagnosticsPanel title="What a bug report attaches" />

        <p className="text-base text-bm-muted">
          A report becomes a GitHub issue on{" "}
          <span className="font-mono">{repo ?? "the household's tracker"}</span>
          , filed by the household&apos;s GitHub token rather than you, and
          labelled <span className="font-mono">source:in-app</span>. Anyone can
          read it: the repository is public. Nothing of it is kept in Baumy.
          Your name and email are never in it; your member id is, so an admin
          can see who to ask.
          {aiAvailable
            ? " With “Improve with AI” ticked, the stripped text is sent to Claude first, to be rewritten as a title and steps. A report that speaks to its reader, asks for data, or holds someone else's details skips that step and is labelled needs-human."
            : null}
        </p>
      </div>
    </Card>
  );
}
