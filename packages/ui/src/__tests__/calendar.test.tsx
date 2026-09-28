import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CalendarDayCell,
  CalendarEventButton,
  CalendarGrid,
} from "../calendar";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("CalendarGrid", () => {
  it("is a labelled list of days, seven wide from sm up for a week", () => {
    const out = html(
      <CalendarGrid columns={7} weekdays label="Jan 2027">
        <CalendarDayCell label="15" />
      </CalendarGrid>,
    );
    expect(out).toContain('role="region"');
    expect(out).toContain('aria-label="Jan 2027"');
    expect(out).toContain("sm:grid-cols-7");
    expect(out).toContain("Mon");
    expect(out).toContain("Sun");
  });

  it("is one column with no weekday row for a day", () => {
    const out = html(
      <CalendarGrid columns={1} label="Fri 15 Jan">
        <CalendarDayCell label="Fri 15 Jan" tall />
      </CalendarGrid>,
    );
    expect(out).not.toContain("sm:grid-cols-7");
    expect(out).not.toContain("Mon");
    expect(out).toContain("min-h-40");
  });
});

describe("CalendarDayCell", () => {
  it("marks today, and mutes a day outside the month", () => {
    const today = html(<CalendarDayCell label="15" today data-testid="d" />);
    expect(today).toContain('aria-current="date"');
    expect(today).toContain('data-testid="d"');
    const other = html(<CalendarDayCell label="31" muted />);
    expect(other).not.toContain("aria-current");
    expect(today).toContain("bg-bm-violet");
    expect(other).toContain("opacity-40");
    expect(other).not.toContain("bg-bm-violet");
  });
});

describe("CalendarDayCell's short label", () => {
  it("shows the day number from sm up, the full day on a phone and to readers", () => {
    const out = html(<CalendarDayCell label="Fri 15 Jan" shortLabel="15" />);
    expect(out).toContain('<span class="sm:hidden">Fri 15 Jan</span>');
    expect(out).toContain('aria-hidden="true">15</span>');
    expect(out).toContain(
      '<span class="max-sm:hidden sr-only">Fri 15 Jan</span>',
    );
    const plain = html(<CalendarDayCell label="Fri 15 Jan" />);
    expect(plain).not.toContain("sm:hidden");
  });
});

describe("CalendarEventButton", () => {
  it("is a 44px button with the time and title, 56px on the kiosk", () => {
    const out = html(<CalendarEventButton title="Dinner" time="19:00" />);
    expect(out).toContain('type="button"');
    expect(out).toContain("19:00");
    expect(out).toContain("Dinner");
    expect(out).toContain("min-h-11");
    expect(
      html(<CalendarEventButton title="Dinner" time="19:00" kiosk />),
    ).toContain("min-h-14");
  });

  it("takes whose colour it is, violet without one", () => {
    const plain = html(<CalendarEventButton title="Dinner" time="19:00" />);
    expect(plain).toContain("[--chip:var(--color-bm-violet)]");
    expect(plain).not.toContain("style=");
    const ryan = html(
      <CalendarEventButton
        title="Dinner"
        time="19:00"
        accent="#3b82c4"
        style={{ width: 10 }}
      />,
    );
    expect(ryan).toContain("--chip:#3b82c4");
    expect(ryan).toContain("width:10px");
  });
});
