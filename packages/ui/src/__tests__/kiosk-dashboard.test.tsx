import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActingChip,
  actingDoneClass,
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
  NotificationIconFace,
  WeekdayRow,
  WhoLine,
  kioskArrowClass,
  kioskNavItemClass,
  notificationIconClass,
  notificationIconLabel,
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
      <NotificationIcon
        icon="envelope"
        label="Messages"
        tone="pink"
        count={5}
      />,
    );
    expect(out).toContain('aria-label="Messages: 5"');
    expect(out).toContain('data-count="5"');
    expect(out).toContain('type="button"');
    expect(out).toContain("h-[124px] w-[120px]");
    expect(out).toMatch(
      /data-badge[^>]*background:var\(--color-bm-pink\)[^>]*>5</,
    );
    expect(out).toContain("Messages</span>");
    expect(out).not.toContain("grayscale");
  });

  it("goes dim at zero, with no badge", () => {
    const out = html(
      <NotificationIcon
        icon="envelope"
        label="Messages"
        tone="pink"
        count={0}
      />,
    );
    expect(out).toContain('aria-label="Messages: 0"');
    expect(out).toContain("grayscale(1)");
    expect(out).toContain("text-bm-dim");
    expect(out).not.toContain("data-badge");
  });
});

describe("NotificationIcon that could not be read", () => {
  it("says unavailable, dim and with no badge, never a false zero", () => {
    const out = html(
      <NotificationIcon
        icon="basket"
        label="Shopping"
        tone="amber"
        count={null}
      />,
    );
    expect(out).toContain('aria-label="Shopping: unavailable"');
    expect(out).toContain('data-status="unavailable"');
    expect(out).not.toContain("data-count");
    expect(out).toContain("grayscale(1)");
    expect(out).not.toContain("data-badge");
    expect(
      html(
        <NotificationIcon
          icon="envelope"
          label="Messages"
          tone="pink"
          count={0}
        />,
      ),
    ).toContain('data-status="ready"');
  });
});

describe("NotificationIconFace for a link", () => {
  it("is lit with no badge when it has no count (the Bounties star)", () => {
    const out = html(
      <a className={notificationIconClass} href="/kiosk/chores">
        <NotificationIconFace icon="star" label="Bounties" tone="yellow" />
      </a>,
    );
    expect(out).toContain("h-[124px] w-[120px]");
    expect(out).toContain("Bounties</span>");
    expect(out).toContain("bg-bm-surface");
    expect(out).not.toContain("grayscale");
    expect(out).not.toContain("data-badge");
  });

  it("badges a count in its accent, and dims at zero", () => {
    const three = html(
      <NotificationIconFace
        icon="basket"
        label="Shopping"
        tone="amber"
        count={3}
      />,
    );
    expect(three).toMatch(
      /data-badge[^>]*background:var\(--color-bm-amber\)[^>]*>3</,
    );
    const none = html(
      <NotificationIconFace
        icon="basket"
        label="Shopping"
        tone="amber"
        count={0}
      />,
    );
    expect(none).toContain("grayscale(1)");
    expect(none).not.toContain("data-badge");
  });

  it("names a count, an unreadable count, or none", () => {
    expect(notificationIconLabel("Shopping", 3)).toBe("Shopping: 3");
    expect(notificationIconLabel("Shopping", null)).toBe(
      "Shopping: unavailable",
    );
    expect(notificationIconLabel("Bounties", undefined)).toBe("Bounties");
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

describe("ModulePanel", () => {
  it("frames the module in its accent, with a 64px close", () => {
    const out = html(
      <ModulePanel
        title="Messages"
        titleId="m-title"
        icon="envelope"
        tone="pink"
        subtitle="2 not read by everyone yet"
        onClose={noop}
      >
        <p>rows</p>
      </ModulePanel>,
    );
    expect(out).toContain("--pf:var(--color-bm-pink)");
    expect(out).toContain('<h2 id="m-title"');
    expect(out).toContain("2 not read by everyone yet");
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain("size-16");
    expect(out).toContain("<p>rows</p>");
    // The list scrolls in the pixel scrollbar, with "More below" when long.
    expect(out).toContain("data-scroll-list");
    expect(out).toContain("data-track");
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

  it("puts an action (Remove, issue #194) under the text, only when given", () => {
    const out = html(
      <MessageRow
        who={null}
        name="Jo"
        colour="#fff"
        when="now"
        title="Hi"
        action={<button>Remove</button>}
      />,
    );
    expect(out).toMatch(/>Hi<\/div><div class="mt-3 flex"><button>Remove</);
    expect(
      html(
        <MessageRow who={null} name="Jo" colour="#fff" when="now" title="Hi" />,
      ),
    ).not.toContain("mt-3 flex");
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
