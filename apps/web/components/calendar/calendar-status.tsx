import Link from "next/link";
import { Card, FormMessage, buttonClass } from "@baumy/ui";
import type { ActionFailure } from "@/lib/actions/result";

// What /calendar and the kitchen screen show when `list_events` cannot answer. A
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

/**
 * The kitchen screen's version (issue #134): nobody there can set an env
 * var, so it says what is going on in plain words, and for an outage offers
 * a big "Try again" that reads the calendar afresh.
 */
export function KioskCalendarStatus({ failure }: { failure: ActionFailure }) {
  if (failure.code === "NOT_CONFIGURED") {
    return (
      <Card
        title="Not connected yet"
        data-testid="calendar-not-configured"
        className="max-w-2xl"
      >
        <p className="text-lg text-bm-muted">
          The house calendar isn&apos;t connected to Google yet, so there is
          nothing to show or change here. An admin can connect it from their
          computer.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Google isn't answering"
      data-testid="calendar-unavailable"
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <FormMessage tone="error">{failure.message}</FormMessage>
        <div>
          <Link
            href="/kiosk/calendar"
            prefetch={false}
            className={buttonClass("secondary", "kiosk")}
          >
            Try again
          </Link>
        </div>
      </div>
    </Card>
  );
}
