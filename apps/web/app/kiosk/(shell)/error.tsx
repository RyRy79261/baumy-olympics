"use client";

import { ErrorRecovery } from "@/components/feedback/error-recovery";

// The kitchen screen's error boundary (issue #133): the footer nav and Baumy
// stay, with Report, Try again and Home as 56px targets.
export default function KioskError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} kiosk />;
}
