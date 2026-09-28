import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActingChip,
  actingDoneClass,
  ModuleBountyRow,
  DayEventRow,
  EventChip,
  KIOSK_FOOTER_H,
  KioskFooter,
  KioskNavItem,
  MessageRow,
  ModuleEmpty,
  ModulePanel,
  MonthDayCell,
  NotificationIcon,
  SheetTabs,
  WeekdayRow,
  WhoLine,
  bountyActionClass,
  kioskArrowClass,
  kioskNavItemClass,
  tint,
  todayButtonClass,
  toneColour,
} from "../kiosk-dashboard";

// The portrait kitchen dashboard's parts (ADR 0005, issue #65): the
// prototype's look (variant A), one accent per meaning, 56px targets.

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

describe("accents", () => {
  it("names the kit's colours and tints them over transparent", () => {
    expect(toneColour("red")).toBe("var(--color-bm-red)");
    expect(tint("#4ff5e6", 22)).toBe(
      "color-mix(in srgb, #4ff5e6 22%, transparent)",
    );
  });
});

describe("NotificationIcon", () => {
  it("shows its count in a badge in its accent", () => {
    const out = html(
      <NotificationIcon icon="siren" label="Urgent" tone="red" count={5} />,
    );
    expect(out).toContain('aria-label="Urgent: 5"');
    expect(out).toContain('data-count="5"');
    expect(out).toContain('type="button"');
    expect(out).toContain("h-[124px] w-[120px]");
    expect(out).toMatch(
      /data-badge[^>]*background:var\(--color-bm-red\)[^>]*>5</,
    );
    expect(out).toContain("Urgent</span>");
    expect(out).not.toContain("grayscale");
  });

  it("goes dim at zero, with no badge", () => {
    const out = html(
      <NotificationIcon icon="star" label="New" tone="yellow" count={0} />,
    );
    expect(out).toContain('aria-label="New: 0"');
    expect(out).toContain("grayscale(1)");
    expect(out).toContain("text-bm-dim");
    expect(out).not.toContain("data-badge");
  });
});

describe("NotificationIcon that could not be read", () => {
  it("says unavailable, dim and with no badge, never a false zero", () => {
    const out = html(
      <NotificationIcon icon="siren" label="Urgent" tone="red" count={null} />,
    );
    expect(out).toContain('aria-label="Urgent: unavailable"');
    expect(out).toContain('data-status="unavailable"');
    expect(out).not.toContain("data-count");
    expect(out).toContain("grayscale(1)");
    expect(out).not.toContain("data-badge");
    expect(
      html(
        <NotificationIcon icon="star" label="New" tone="yellow" count={0} />,
      ),
    ).toContain('data-status="ready"');
  });
});

describe("ActingChip", () => {
  it("names who is acting beside their character, with Done", () => {
    const out = html(
      <ActingChip
        who={<i>ryan</i>}
        name="Ryan"
        done={<button className={actingDoneClass}>Done</button>}
      />,
    );
    expect(out).toContain('data-testid="acting-chip"');
    expect(out).toMatch(/data-testid="acting-as"[^>]*>Ryan</);
    expect(out).toContain("<i>ryan</i>");
    expect(out).toContain(">Done</button>");
    // Both the chip and its Done are 56px targets.
    expect(out).toContain("h-14");
    expect(actingDoneClass).toContain("h-14 min-w-14");
  });
});

describe("ModulePanel and SheetTabs", () => {
  it("frames the module in its accent, with a 64px close and the tabs", () => {
    const out = html(
      <ModulePanel
        title="Urgent"
        titleId="m-title"
        icon="siren"
        tone="red"
        subtitle="Overdue or due before midnight"
        onClose={noop}
        tabs={<div>tabs</div>}
      >
        <p>rows</p>
      </ModulePanel>,
    );
    expect(out).toContain("--pf:var(--color-bm-red)");
    expect(out).toContain('<h2 id="m-title"');
    expect(out).toContain("Overdue or due before midnight");
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain("size-16");
    expect(out).toContain("<div>tabs</div>");
    expect(out).toContain("<p>rows</p>");
    // The list scrolls in the pixel scrollbar, with "More below" when long.
    expect(out).toContain("data-scroll-list");
    expect(out).toContain("data-track");
    expect(
      html(
        <ModulePanel
          title="Messages"
          icon="envelope"
          tone="pink"
          subtitle="x"
          onClose={noop}
        >
          y
        </ModulePanel>,
      ),
    ).not.toContain("px-7 pb-4");
  });

  it("presses the picked tab in its accent and counts each", () => {
    const out = html(
      <SheetTabs
        value="all"
        onPick={noop}
        items={[
          { key: "all", label: "All", count: 5, tone: "red" },
          { key: "consumable", label: "Consumables", count: 2, tone: "amber" },
        ]}
      />,
    );
    expect(out).toMatch(/data-tab="all" aria-pressed="true"/);
    expect(out).toMatch(/data-tab="consumable" aria-pressed="false"/);
    expect(out).toContain("color-mix(in srgb, var(--color-bm-red) 13%");
    expect(out).toContain("h-14");
    expect(out).toContain("color:var(--color-bm-dim)");
  });
});

describe("ModuleBountyRow", () => {
  it("shows the kind, whose streak you steal, the deadline and the points", () => {
    const out = html(
      <ModuleBountyRow
        glyph="bin"
        name="Bins out"
        kind="maintenance"
        streak={{ name: "Ryan", length: 6, colour: "#4ff5e6" }}
        due={{ text: "in 2h", tone: "soon" }}
        points={20}
        action={<a href="/x">I&apos;ll do it</a>}
      />,
    );
    expect(out).toContain("Bins out");
    expect(out).toContain("Maintenance");
    expect(out).toContain("color:var(--color-bm-teal)");
    expect(out).toMatch(
      /data-streak[^>]*whitespace-nowrap[^>]*color:#4ff5e6[^>]*>steal Ryan&#x27;s 6× streak/,
    );
    expect(out).toMatch(
      /data-due="soon"[^>]*color:var\(--color-bm-amber\)[^>]*>in 2h/,
    );
    expect(out).toContain("+20");
    expect(out).toContain('data-glyph="bin"');
    expect(out).toContain('href="/x"');
    expect(out).not.toContain(">new<");
  });

  it("says new and no streak yet, in the consumable's amber", () => {
    const out = html(
      <ModuleBountyRow
        glyph="catfood"
        name="Cat food"
        kind="consumable"
        isNew
        streak={null}
        due={{ text: "3h late", tone: "late" }}
        points={null}
        action={null}
      />,
    );
    expect(out).toContain(">new<");
    expect(out).toContain("no streak yet");
    expect(out).toContain("Consumable");
    expect(out).toContain("color:var(--color-bm-red)");
    expect(out).not.toContain('text-bm-yellow">+');
  });

  it("gives the action a 60px frame of its own", () => {
    expect(bountyActionClass).toContain("h-[60px]");
    expect(bountyActionClass).toContain("[--pf-w:3px]");
    expect(html(<ModuleEmpty>Nothing here.</ModuleEmpty>)).toContain(
      "Nothing here.",
    );
  });
});

describe("MessageRow", () => {
  it("shows who, when and what, with the body under it", () => {
    const out = html(
      <MessageRow
        who={<i>ryan</i>}
        name="Ryan"
        colour="#ff8fc7"
        when="12m ago"
        title="Pasta"
      >
        <b>body</b>
      </MessageRow>,
    );
    expect(out).toContain("<i>ryan</i>");
    expect(out).toMatch(/color:#ff8fc7[^>]*>Ryan <span[^>]*>· 12m ago/);
    expect(out).toContain("Pasta");
    expect(out).toContain("line-clamp-2");
    expect(
      html(
        <MessageRow who={null} name="Jo" colour="#fff" when="now" title="Hi" />,
      ),
    ).not.toContain("line-clamp-2");
  });
});

describe("the month grid", () => {
  it("marks today in violet, and dims the months either side", () => {
    const today = html(
      <MonthDayCell date={28} inMonth today more={2}>
        <EventChip title="Climbing" colour="#4ff5e6" />
      </MonthDayCell>,
    );
    expect(today).toContain('aria-current="date"');
    expect(today).toContain("[--pf:var(--color-bm-violet)]");
    expect(today).toContain("bg-bm-violet text-bm-ink");
    expect(today).toContain("+2 more");
    expect(today).toContain("Climbing");
    const out = html(<MonthDayCell date={1} inMonth={false} />);
    expect(out).toContain("opacity-40");
    expect(out).not.toContain("aria-current");
    expect(out).not.toContain("more");
    expect(html(<MonthDayCell date={3} inMonth past more={1} />)).toMatch(
      /text-bm-dim"[^>]*>\+1 more/,
    );
    expect(html(<MonthDayCell date={5} inMonth weekend />)).toContain(
      "text-bm-muted",
    );
    expect(html(<MonthDayCell date={7} inMonth />)).toContain("text-bm-text");
  });

  it("draws a chip in its owner's colour, faint for a day gone by", () => {
    const out = html(<EventChip title="Yoga" colour="#8f7dff" dim />);
    expect(out).toContain("color-mix(in srgb, #8f7dff 22%, transparent)");
    expect(out).toContain("background:#8f7dff");
    expect(out).toContain("opacity-50");
    expect(html(<EventChip title="Yoga" colour="#8f7dff" />)).not.toContain(
      "opacity-50",
    );
  });

  it("dims the weekend in the weekday row", () => {
    const out = html(<WeekdayRow gap={6} />);
    expect(out.match(/text-bm-dim/g)).toHaveLength(2);
    expect(out).toContain("Mon");
    expect(out).toContain("gap:6px");
  });

  it("has 56px arrows and a Today that dims on this month", () => {
    expect(kioskArrowClass).toContain("pixel-frame");
    expect(todayButtonClass(true)).toContain("text-bm-dim");
    expect(todayButtonClass(false)).toContain("[--pf:var(--color-bm-violet)]");
  });
});

describe("the day sheet", () => {
  it("shows the time, the owner's bar, the title and who", () => {
    const out = html(
      <DayEventRow
        start="07:30"
        end="to 08:00"
        colour="#ffb347"
        title="Recycling pickup"
        who={<WhoLine name="House" colour="#ffb347" />}
      />,
    );
    expect(out).toContain("07:30");
    expect(out).toContain("to 08:00");
    expect(out).toContain("background:#ffb347");
    expect(out).toContain("Recycling pickup");
    expect(out).toContain("House");
    expect(out).toContain("text-[26px]");
    const allDay = html(
      <DayEventRow
        start="All day"
        end=""
        colour="#fff"
        title="Trip"
        dim
        who={<WhoLine who={<i>jo</i>} name="Jo" colour="#fff" />}
      />,
    );
    expect(allDay).toContain("text-[18px]");
    expect(allDay).toContain("opacity-60");
    expect(allDay).toContain("<i>jo</i>");
    expect(allDay).not.toContain("mt-3 font-label");
  });
});

describe("the footer", () => {
  it("is an 84px nav bar that keeps Baumy's corner clear", () => {
    const out = html(
      <KioskFooter>
        <a className={kioskNavItemClass(true)}>
          <KioskNavItem glyph="home" label="Home" />
        </a>
      </KioskFooter>,
    );
    expect(KIOSK_FOOTER_H).toBe(84);
    expect(out).toContain('aria-label="Kiosk"');
    expect(out).toContain("height:84px");
    expect(out).toContain("pr-[160px]");
    expect(out).toContain('data-glyph="home"');
    expect(out).toContain("Home</span>");
    expect(kioskNavItemClass(true)).toContain("text-bm-text");
    expect(kioskNavItemClass(false)).toContain("text-bm-dim");
  });
});
