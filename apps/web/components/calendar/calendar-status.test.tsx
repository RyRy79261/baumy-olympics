import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calendarFailure } from "@/lib/actions/calendar";
import { CalendarStatus, KioskCalendarStatus } from "./calendar-status";

// Acceptance (issue #19): without credentials the calendar says it is not
// configured, rather than showing an error.

describe("CalendarStatus", () => {
  it("says 'not connected' without credentials, with no error role", () => {
    const out = renderToStaticMarkup(
      <CalendarStatus
        failure={calendarFailure({ ok: false, reason: "not_configured" })}
      />,
    );
    expect(out).toContain('data-testid="calendar-not-configured"');
    expect(out).toContain("Not connected yet");
    expect(out).toContain("GOOGLE_CALENDAR_ID");
    expect(out).not.toContain('role="alert"');
  });

  it("shows other failures as an error the user can act on", () => {
    const out = renderToStaticMarkup(
      <CalendarStatus
        failure={calendarFailure({ ok: false, reason: "unavailable" })}
      />,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("Try again in a minute");
    expect(out).not.toContain("Not connected yet");
  });
});

describe("KioskCalendarStatus (issue #134)", () => {
  it("says 'not connected' in plain words, with no env vars and no error", () => {
    const out = renderToStaticMarkup(
      <KioskCalendarStatus
        failure={calendarFailure({ ok: false, reason: "not_configured" })}
      />,
    );
    expect(out).toContain('data-testid="calendar-not-configured"');
    expect(out).toContain("Not connected yet");
    expect(out).toContain("An admin can connect it");
    expect(out).not.toContain("GOOGLE_CALENDAR_ID");
    expect(out).not.toContain('role="alert"');
  });

  it("says Google is not answering, with a way to try again", () => {
    const out = renderToStaticMarkup(
      <KioskCalendarStatus
        failure={calendarFailure({ ok: false, reason: "unavailable" })}
      />,
    );
    expect(out).toContain('data-testid="calendar-unavailable"');
    expect(out).toContain('role="alert"');
    expect(out).toContain("Try again in a minute");
    expect(out).toContain('href="/kiosk/calendar"');
    expect(out).not.toContain("Not connected yet");
  });
});
