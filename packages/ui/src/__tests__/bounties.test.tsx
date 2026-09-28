import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AgendaItem,
  BountyGlyph,
  BountyList,
  BountyRow,
  BountySummary,
  StatusTileFace,
  TabLabel,
  statusTileClass,
  tabClass,
} from "../bounties";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("BountyRow", () => {
  it("is one button with the glyph, name, kind, streak, status and points", () => {
    const out = html(
      <BountyRow
        name="Toilet paper"
        sprite="tp"
        kind="consumable"
        points={15}
        streak="Ryan · streak 3"
        status="Due since Wed 30 Sep, 08:00"
        urgent
        isNew
      />,
    );
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('type="button"');
    expect(out).toContain('data-kind="consumable"');
    expect(out).toContain('data-urgent="true"');
    expect(out).toContain('data-sprite="tp"');
    expect(out).toContain('data-glyph="tp"');
    expect(out).toContain("Toilet paper");
    expect(out).toContain("Consumable");
    expect(out).toContain("text-bm-amber");
    expect(out).toContain("Ryan · streak 3");
    expect(out).toContain("15 pts");
    // New in yellow; urgent is said once, by the status line in red.
    expect(out).toMatch(/text-bm-yellow uppercase">New</);
    expect(out).toMatch(/text-bm-red">Due since/);
    expect(out).not.toContain(">Urgent<");
    // The kind and the streak are two phrases that each stay whole.
    expect(out).toMatch(/whitespace-nowrap text-bm-amber">Consumable</);
    // The "Log it" at the end is only for the eye.
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("Log it");
  });

  it("is calm when nothing is pressing, and has no points without a weight", () => {
    const out = html(
      <BountyRow
        name="Mop"
        sprite="mop"
        kind="maintenance"
        points={null}
        streak="No streak yet"
        status="Again from Thu 1 Oct, 08:00"
        cta="Open"
      />,
    );
    expect(out).toContain('data-urgent="false"');
    expect(out).toContain("Maintenance");
    expect(out).toContain("text-bm-teal");
    expect(out).not.toContain(">New<");
    expect(out).not.toContain(">Urgent<");
    expect(out).not.toContain("pts");
    expect(out).toMatch(/text-bm-dim">Again from/);
    expect(out).toContain("Open");
    expect(out).toContain("min-h-16");
  });

  it("is a bigger target on the kiosk, its button always shown", () => {
    const out = html(
      <BountyRow
        name="Bins"
        sprite="trash"
        kind="maintenance"
        points={20}
        streak="No streak yet"
        status="Due"
        kiosk
      />,
    );
    expect(out).toContain("min-h-24");
    expect(out).toContain("text-3xl");
    expect(out).toContain("inline-flex min-h-14");
    expect(out).not.toContain("hidden min-h-11");
  });

  it("lists rows with a line between", () => {
    const out = html(
      <BountyList aria-label="Bounties" className="extra">
        <li>a</li>
      </BountyList>,
    );
    expect(out).toContain('aria-label="Bounties"');
    expect(out).toContain("divide-y-2");
    expect(out).toContain("extra");
  });
});

describe("BountyGlyph", () => {
  it("frames the glyph in its kind's colour, at three sizes", () => {
    const small = html(
      <BountyGlyph sprite="catfood" kind="consumable" size="small" />,
    );
    expect(small).toContain('data-sprite="catfood"');
    expect(small).toContain('data-glyph="catfood"');
    expect(small).toContain("text-bm-amber");
    expect(small).toContain("size-10");
    expect(small).toContain('width="24"');
    const normal = html(<BountyGlyph sprite="bin" kind="maintenance" />);
    expect(normal).toContain("text-bm-teal");
    expect(normal).toContain("size-12");
    expect(normal).toContain('width="32"');
    const kiosk = html(
      <BountyGlyph sprite="bin" kind="maintenance" size="kiosk" />,
    );
    expect(kiosk).toContain("size-16");
    expect(kiosk).toContain('width="40"');
  });
});

describe("BountySummary", () => {
  it("is a list line with the same face, and no button", () => {
    const out = html(
      <BountySummary
        data-testid="hub-chore-Bins"
        name="Bins"
        sprite="trash"
        kind="maintenance"
        points={20}
        streak="No streak yet"
        status="Never done"
        urgent
        isNew
      />,
    );
    expect(out.startsWith("<li")).toBe(true);
    expect(out).not.toContain("<button");
    expect(out).toContain('data-testid="hub-chore-Bins"');
    expect(out).toContain('data-urgent="true"');
    expect(out).toContain("Maintenance");
    expect(out).toContain("20 pts");
    expect(out).toContain(">New<");
    expect(out).toMatch(/text-bm-red">Never done/);
    expect(out).not.toContain(">Urgent<");
    const calm = html(
      <BountySummary
        name="Mop"
        sprite="mop"
        kind="consumable"
        points={null}
        streak="No streak yet"
        status="Due at 18:00"
      />,
    );
    expect(calm).toContain('data-urgent="false"');
    expect(calm).not.toContain(">New<");
  });
});

describe("AgendaItem", () => {
  it("shows the time, the bar in its colour, the title and the line under", () => {
    const out = html(
      <AgendaItem
        time="19:00"
        until="to 20:30"
        title="Dinner"
        secondary="Kitchen"
        accent="#3b82c4"
        style={{ opacity: 1 }}
      />,
    );
    expect(out).toContain("19:00");
    expect(out).toContain("to 20:30");
    expect(out).toContain("Dinner");
    expect(out).toContain("Kitchen");
    expect(out).toContain("--chip:#3b82c4");
    expect(out).toContain("opacity:1");
  });

  it("is violet without a colour, and leaves out what it is not given", () => {
    const out = html(<AgendaItem time="All day" title="Bins" />);
    expect(out).toContain("[--chip:var(--color-bm-violet)]");
    expect(out).not.toContain("style=");
    expect(out).not.toContain("text-bm-dim uppercase");
    expect(out).not.toContain("text-bm-muted uppercase");
  });
});

describe("filter tabs", () => {
  it("frames the chosen tab in its accent, and leaves the others quiet", () => {
    expect(tabClass(true, "red")).toContain("--pf:var(--color-bm-red)");
    expect(tabClass(true)).toContain("--pf:var(--color-bm-violet)");
    expect(tabClass(false, "red")).toContain("text-bm-muted");
    expect(tabClass(false, "red")).not.toContain("bm-red");
    expect(tabClass(false)).toContain("min-h-11");
    expect(tabClass(false, "teal", true)).toContain("min-h-14");
  });

  it("shows the count in the accent only when chosen", () => {
    const on = html(<TabLabel label="Urgent" count={3} on accent="red" />);
    expect(on).toContain("Urgent");
    expect(on).toMatch(/text-bm-red">3</);
    const off = html(<TabLabel label="Urgent" count={3} on={false} />);
    expect(off).toMatch(/text-bm-dim">3</);
    const bare = html(<TabLabel label="All" on />);
    expect(bare).toBe("All");
  });
});

describe("status tiles", () => {
  it("shows the icon, the label and a count badge in its accent", () => {
    const out = html(
      <StatusTileFace icon="siren" label="Urgent" count={5} accent="red" />,
    );
    expect(out).toContain("Urgent");
    expect(out).toMatch(/bg-bm-red">5</);
    expect(out).toContain("data-count");
    expect(out).not.toContain("grayscale");
    expect(statusTileClass(true)).toContain("bg-bm-surface");
  });

  it("goes dim at zero, with no badge", () => {
    const out = html(
      <StatusTileFace icon="star" label="New" count={0} accent="yellow" />,
    );
    expect(out).toContain("New");
    expect(out).toContain("grayscale");
    expect(out).not.toContain("data-count");
    expect(out).not.toContain("Unavailable");
    expect(statusTileClass(false)).not.toContain("bg-bm-surface");
  });

  it("says Unavailable, with no badge and no zero, when the count could not be read", () => {
    const out = html(
      <StatusTileFace
        icon="envelope"
        label="Messages"
        count={null}
        accent="pink"
      />,
    );
    expect(out).toContain("Messages");
    expect(out).toContain("Unavailable");
    expect(out).toContain("grayscale");
    expect(out).not.toContain("data-count");
    expect(out).not.toContain(">0<");
  });
});
