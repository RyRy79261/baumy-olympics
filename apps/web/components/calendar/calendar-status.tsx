import { Card, FormMessage } from "@baumy/ui";
import type { ActionFailure } from "@/lib/actions/result";

// What /calendar and the kiosk show when `list_events` cannot answer. A
// deployment without Google credentials is NOT an error: the page says the
// calendar is not connected yet, and how to fix it.

export function CalendarStatus({ failure }: { failure: ActionFailure }) {
  if (failure.code === "NOT_CONFIGURED") {
    return (
      <Card
        title="Not connected yet"
        data-testid="calendar-not-configured"
        className="max-w-xl"
      >
        <p className="text-sm text-bm-muted">
          The house calendar is not configured on this deployment. Once an admin
          shares the Google Calendar with the house&apos;s service account and
          sets GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_CLIENT_EMAIL and
          GOOGLE_CALENDAR_PRIVATE_KEY, the events show here.
        </p>
      </Card>
    );
  }
  return <FormMessage tone="error">{failure.message}</FormMessage>;
}
