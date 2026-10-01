import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell, navBadgeClass, navItemClass } from "../app-shell";
import {
  BaumyCat,
  MARK_ART_PX,
  baumyFrames,
  baumyPalette,
  markAnchor,
} from "../baumy-cat";
import { CalendarDayCell, CalendarEventButton } from "../calendar";
import { Card } from "../card";
import { ChoiceGroup, ChoreTile } from "../chores";
import { Input } from "../field";
import { KioskFooter } from "../kiosk-dashboard";
import { AvatarButton, KioskShell, KioskTopBar } from "../kiosk-shell";
import { BAUMY_COLOURS, BAUMY_FRAMES } from "../pixel/baumy-cat";
import { ToastItem, ToastList, toastDismissClass } from "../toast";

// The owner's review of the pixel kit (PR #69): calm tiles, readable kiosk
// names, marks on the art, a shut eye asleep, square calendar cells, the
// header tokens, and toasts off the kiosk's notices.

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const tile = (props: Partial<React.ComponentProps<typeof ChoreTile>> = {}) =>
  html(
    <ChoreTile
      name="Dishwasher (unload)"
      sprite="dishwasher"
      points={25}
      streak="Josephine · streak 3"
      status="Due since Sun 27 Sep"
      state="due"
      {...props}
    />,
  );

describe("ChoreTile", () => {
  it("wraps a long name to two lines instead of cutting it", () => {
    const out = tile({ kiosk: true });
    expect(out).toMatch(/data-tile-name="true" class="[^"]*line-clamp-2/);
    expect(out).not.toMatch(/data-tile-name="true" class="[^"]*truncate/);
    expect(out).toMatch(/data-tile-name="true" class="[^"]*text-2xl/);
  });

  it("shows the points at text-base or larger on the kiosk", () => {
    expect(tile({ kiosk: true })).toMatch(
      /data-tile-points="true" class="[^"]*text-base/,
    );
    expect(tile()).toMatch(/data-tile-points="true" class="[^"]*text-xs/);
  });

  it("says due once, in red text, with the same dim frame as any tile", () => {
    const due = tile();
    const later = tile({ state: "cooldown", status: "Again from Thu" });
    expect(due).toMatch(/data-tile-status="true" class="[^"]*text-bm-red/);
    expect(later).toMatch(/data-tile-status="true" class="[^"]*text-bm-dim/);
    for (const out of [due, later]) {
      expect(out).toContain("pixel-frame");
      expect(out).not.toContain("--pf:var(--color-bm-text)");
    }
  });
});

describe("focus rings", () => {
  it("light a whole frame only for a control wrapping a hidden input", () => {
    const choice = html(
      <ChoiceGroup
        legend="Who did it?"
        name="who"
        value="a"
        onChange={() => undefined}
        options={[{ value: "a", label: "Ryan" }]}
      />,
    );
    expect(choice).toContain("pixel-frame-within");
    expect(html(<Card title="Sign in">x</Card>)).not.toContain(
      "pixel-frame-within",
    );
    expect(html(<Input />)).not.toContain("pixel-frame-within");
  });
});

describe("Baumy asleep and its marks", () => {
  it("shuts the eye asleep by colouring it as the coat, on the same frame", () => {
    expect(baumyPalette("sleeping").E).toBe(BAUMY_COLOURS.K);
    expect(baumyPalette("idle")).toBe(BAUMY_COLOURS);
    expect(baumyFrames("sleeping")).toEqual([BAUMY_FRAMES.idle[0]]);
    const asleep = html(<BaumyCat state="sleeping" />);
    const awake = html(<BaumyCat state="thinking" />);
    expect(awake).toContain(BAUMY_COLOURS.E);
    expect(asleep).not.toContain(BAUMY_COLOURS.E);
  });

  it("places a mark over the drawn head, in the empty rows above it", () => {
    const frame = BAUMY_FRAMES.idle[0]!;
    // The sitting cat's first drawn row is 8, its ears at x 16 to 29.
    expect(frame.findIndex((r) => /[^.]/.test(r))).toBe(8);
    const right = markAnchor(frame, "right");
    expect(right.top).toBe(8 - MARK_ART_PX - 1);
    expect(right.x).toBeGreaterThan(16);
    expect(right.x).toBeLessThan(30);
    // Facing left mirrors it across the 34-pixel frame.
    expect(markAnchor(frame, "left").x).toBe(34 - right.x);
    // Never above the frame.
    expect(markAnchor(["..K..", "....."], "right")).toEqual({ top: 0, x: 2.5 });
  });

  it("draws the mark as violet pixel type at the anchor, scaled", () => {
    const out = html(<BaumyCat state="sleeping" scale={4} facing="left" />);
    const { top, x } = markAnchor(BAUMY_FRAMES.idle[0]!, "left");
    expect(out).toContain(`top:${top * 4}px;left:${x * 4}px`);
    expect(out).toContain(`font-size:${MARK_ART_PX * 4}px`);
    expect(out).toMatch(/data-mark="true" class="[^"]*text-bm-violet/);
    expect(out).not.toContain("bg-bm-text");
  });
});

describe("kiosk avatars", () => {
  it("stack the character over a one-line name, small enough for four", () => {
    const out = html(
      <AvatarButton displayName="Josephine-Marie" color="#ff8fc7" />,
    );
    expect(out).toContain("flex-col");
    expect(out).toContain("max-w-32");
    expect(out).toContain("text-xs");
    expect(out).toMatch(/class="[^"]*truncate whitespace-nowrap"/);
    // The initial tile fills the 2x slot: 34px square.
    expect(out).toContain("width:34px;height:34px");
  });
});

describe("toasts and the kiosk's notices", () => {
  it("move under the header on the kiosk, with a 56px Dismiss there", () => {
    const list = html(
      <ToastList>
        <ToastItem variant="info" onDismiss={() => undefined}>
          Hi
        </ToastItem>
      </ToastList>,
    );
    expect(list).toContain("bottom-4");
    expect(list).toContain("[body:has([data-kiosk])_&amp;]:top-24");
    expect(toastDismissClass).toContain("min-h-11");
    expect(toastDismissClass).toContain("[body:has([data-kiosk])_&]:min-h-14");
    expect(toastDismissClass).toContain("[body:has([data-kiosk])_&]:min-w-14");
    expect(list).toContain(">Dismiss</button>");
    expect(html(<ToastItem variant="info">No button</ToastItem>)).not.toContain(
      "Dismiss",
    );
  });
});

describe("header tokens and calendar cells", () => {
  it("colour both shells' bars with the chrome token", () => {
    expect(
      html(
        <AppShell brand="B" nav={null}>
          x
        </AppShell>,
      ),
    ).toContain("bg-bm-chrome");
    expect(html(<KioskTopBar avatars={null} />)).toContain("bg-bm-chrome");
    expect(
      html(<KioskShell footer={<KioskFooter>x</KioskFooter>}>x</KioskShell>),
    ).toContain("bg-bm-chrome");
  });

  it("keep the nav one row only from xl, wrapping (never scrolling) below", () => {
    const out = html(
      <AppShell brand="B" nav={<a>Hub</a>}>
        x
      </AppShell>,
    );
    const nav = /aria-label="Main" class="([^"]*)"/.exec(out)![1]!;
    expect(nav.split(" ")).toContain("flex-wrap");
    expect(nav).toContain("xl:flex-nowrap");
    expect(nav).toContain("max-xl:basis-full");
    expect(nav).not.toContain("overflow-x-auto");
    expect(out).toMatch(/max-w-7xl[^"]*xl:flex-nowrap/);
    expect(navItemClass(false)).toContain("whitespace-nowrap");
    // On a phone the brand shows only Baumy; the name stays for readers.
    expect(out).toContain('<span class="max-sm:sr-only">B</span>');
  });

  it("pin the Needs-your-OK badge in yellow, stronger when it is the page", () => {
    expect(navBadgeClass(false)).toContain("[--pf:var(--color-bm-yellow)]");
    expect(navBadgeClass(false)).toContain("bg-bm-yellow/10");
    expect(navBadgeClass(true)).toContain("bg-bm-yellow/25");
    expect(navBadgeClass(false)).toContain("min-h-11");
  });

  it("draw square cells: a line frame, today a 4px violet one", () => {
    const day = html(<CalendarDayCell label="3" />);
    const today = html(<CalendarDayCell label="4" today />);
    expect(day).toContain("border-2 border-bm-line");
    expect(today).toContain("border-4 border-bm-violet");
    for (const out of [
      day,
      today,
      html(<CalendarEventButton title="x" time="9:00" />),
    ])
      expect(out).not.toContain("pixel-frame");
  });
});
