import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calendarFailure } from "@/lib/actions/calendar";
import { CalendarStatus } from "./calendar-status";

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
