"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, Card, PageHeading, buttonClass } from "@baumy/ui";
import { openReportProblem } from "./report-problem";

// What an error boundary shows (issue #133), after camp-404
// `apps/web/components/error-recovery.tsx`: what happened, the trace to
// quote, and three ways on: Report, Try again, and back home. It renders
// inside the hub layout or the kiosk shell, so the reporter (FeedbackGate)
// is still mounted and Report opens it with the trace filled in.

export function ErrorRecovery({
  error,
  reset,
  kiosk = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  kiosk?: boolean;
}) {
  useEffect(() => {
    // For the console, and for the report's recent errors (client-errors
    // keeps console.error). The digest matches the server log.
    console.error(error);
  }, [error]);

  const size = kiosk ? "kiosk" : "default";
  return (
    <div data-testid="error-recovery">
      <PageHeading
        title="Something went sideways"
        description="An unexpected error tripped Baumy up. Try again; if it keeps happening, report it."
      />
      <Card>
        {error.digest ? (
          <p className="mb-4 font-mono text-sm text-bm-muted">
            Trace: {error.digest}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size={size}
            variant="secondary"
            onClick={() =>
              openReportProblem({
                description: error.digest
                  ? `The page showed an error. Trace: ${error.digest}\n\nWhat I was doing: `
                  : "The page showed an error.\n\nWhat I was doing: ",
              })
            }
          >
            Report
          </Button>
          <Button size={size} onClick={reset}>
            Try again
          </Button>
          <Link
            href={kiosk ? "/kiosk" : "/"}
            className={buttonClass("ghost", size)}
          >
            Back home
          </Link>
        </div>
      </Card>
    </div>
  );
}
