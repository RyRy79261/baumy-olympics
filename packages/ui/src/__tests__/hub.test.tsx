import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BaumyButton,
  ClockFace,
  HubGrid,
  Widget,
  WidgetItem,
  WidgetList,
} from "../hub";
import { NoteGrid, StickyNote } from "../note";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Widget", () => {
  it("shows its children when ready, labelled by its own heading", () => {
    const out = html(
      <Widget
        id="w-notes"
        title="Pinned notes"
        status="ready"
        action={<a href="/notes">All</a>}
      >
        <p>Wifi</p>
      </Widget>,
    );
    expect(out).toContain('aria-labelledby="w-notes-title"');
    expect(out).toContain('<h2 id="w-notes-title"');
    expect(out).toContain('data-status="ready"');
    expect(out).toContain("<p>Wifi</p>");
    expect(out).toContain('href="/notes"');
  });

  it("shows the empty sentence instead of the children", () => {
    const out = html(
      <Widget title="Chores" status="empty" message="Nothing due.">
        <p>not shown</p>
      </Widget>,
    );
    expect(out).toContain('aria-label="Chores"');
    expect(out).toContain("Nothing due.");
    expect(out).not.toContain("not shown");
    expect(out).not.toContain('role="alert"');
  });

  it("says when it is unavailable, as an alert, and keeps its footer", () => {
    const out = html(
      <Widget
        title="Today"
        status="unavailable"
        message="Calendar is down."
        footer={<p>Pot: €5.00</p>}
      />,
    );
    expect(out).toContain("<p>Pot: €5.00</p>");
    expect(out).toContain('role="alert"');
    expect(out).toContain("Calendar is down.");
  });
});

describe("HubGrid", () => {
  it("fills a fixed two-row screen on the kiosk and stacks otherwise", () => {
    expect(html(<HubGrid kiosk />)).toContain("grid-rows-2");
    expect(html(<HubGrid />)).not.toContain("grid-rows-2");
  });
});

describe("ClockFace", () => {
  it("shows the time and the date", () => {
    const out = html(
      <ClockFace time="14:05" date="Sunday 27 September" kiosk />,
    );
    expect(out).toContain(">14:05<");
    expect(out).toContain(">Sunday 27 September<");
    expect(out).toContain("text-5xl");
    expect(html(<ClockFace time="1" date="d" />)).toContain("text-4xl");
  });
});

describe("WidgetList", () => {
  it("renders rows with an optional second line and trailing value", () => {
    const out = html(
      <WidgetList>
        <WidgetItem primary="Trash" secondary="Ryan · streak 2" trailing="20" />
        <WidgetItem primary="Dishes" />
      </WidgetList>,
    );
    expect(out.match(/<li/g)).toHaveLength(2);
    expect(out).toContain("Ryan · streak 2");
    expect(out).toContain(">20<");
  });
});

describe("BaumyButton", () => {
  it("is a named 64px button with the sprite in its state", () => {
    const out = html(<BaumyButton state="listening" />);
    expect(out).toContain('aria-label="Ask Baumy"');
    expect(out).toContain('type="button"');
    expect(out).toContain("min-h-16");
    expect(out).toContain('data-state="listening"');
  });
});

describe("StickyNote", () => {
  it("shows the title, the pin, the body, who wrote it and its buttons", () => {
    const out = html(
      <StickyNote
        title="Wifi"
        color="blue"
        pinned
        meta="By Ryan"
        actions={<button>Unpin</button>}
        clamp
      >
        <p>guest</p>
      </StickyNote>,
    );
    expect(out).toContain('data-color="blue"');
    expect(out).toContain('data-pinned="true"');
    expect(out).toContain("Pinned");
    expect(out).toContain("<p>guest</p>");
    expect(out).toContain("By Ryan");
    expect(out).toContain("<button>Unpin</button>");
    expect(out).toContain("max-h-24");
  });

  it("is plain and unpinned without a colour", () => {
    const out = html(<StickyNote title="Bins" color={null} />);
    expect(out).toContain('data-color="none"');
    expect(out).toContain('data-pinned="false"');
    expect(out).not.toContain("border-l-8");
    expect(out).not.toContain("Pinned");
  });
});

describe("NoteGrid", () => {
  it("lays notes out in columns", () => {
    expect(html(<NoteGrid />)).toContain("lg:grid-cols-3");
  });
});
