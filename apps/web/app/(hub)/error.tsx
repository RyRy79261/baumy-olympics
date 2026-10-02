"use client";

import { ErrorRecovery } from "@/components/feedback/error-recovery";

// The hub's error boundary (issue #133, after camp-404 `app/error.tsx`): a
// page that throws keeps the header and nav, and offers Report, Try again
// and Home. Inside the hub layout, so the reporter is still mounted.
export default function HubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} />;
}
