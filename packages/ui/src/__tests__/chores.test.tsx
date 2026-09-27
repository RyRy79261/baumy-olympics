import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ChoiceGroup,
  ChoreTile,
  ScorePop,
  StreakBrokenBanner,
} from "../chores";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("ChoreTile", () => {
  it("is a button with the sprite, name, points, streak and status", () => {
    const out = html(
      <ChoreTile
        name="Trash"
        sprite="trash"
        points={20}
        streak="Ryan · streak 3"
        status="Due"
        state="due"
      />,
    );
    expect(out).toContain('type="button"');
    expect(out).toContain('data-state="due"');
    expect(out).toContain('data-sprite="trash"');
    expect(out).toContain("Trash");
    expect(out).toContain("20 pts");
    expect(out).toContain("Ryan · streak 3");
    expect(out).toContain("min-h-16");
  });

  it("is a bigger target on the kiosk, and shows no points without a weight", () => {
    const out = html(
      <ChoreTile
        name="Mop"
        sprite="mop"
        points={null}
        streak="No streak yet"
        status="Not scored yet"
        state="unavailable"
        kiosk
      />,
    );
    expect(out).toContain("min-h-20");
    expect(out).not.toContain("pts");
  });
});

describe("ScorePop and StreakBrokenBanner", () => {
  it("announce the points and the broken streak as status messages", () => {
    const pop = html(<ScorePop points={25} />);
    expect(pop).toContain('role="status"');
    expect(pop).toContain("+25");
    expect(pop).toContain("motion-safe:");
    const banner = html(
      <StreakBrokenBanner holderName="Ryan" length={3} bonus={12} />,
    );
    expect(banner).toContain("STREAK BROKEN");
    expect(banner).toContain("Ryan&#x27;s streak of 3 is over: +12 bonus.");
  });
});

describe("ChoiceGroup", () => {
  it("renders one radio per option, the chosen one checked", () => {
    const out = html(
      <ChoiceGroup
        legend="Who did it?"
        name="doneBy"
        value="b"
        onChange={vi.fn()}
        options={[
          { value: "a", label: "Ryan" },
          { value: "b", label: "Partner" },
        ]}
        kiosk
      />,
    );
    expect(out).toContain("<legend");
    expect(out.match(/type="radio"/g)).toHaveLength(2);
    expect(out).toMatch(/checked="" value="b"/);
    expect(out).not.toMatch(/checked="" value="a"/);
    expect(out).toContain("min-h-14");
    const small = html(
      <ChoiceGroup
        legend="x"
        name="n"
        value="a"
        onChange={vi.fn()}
        options={[{ value: "a", label: "A" }]}
      />,
    );
    expect(small).toContain("min-h-11");
  });
});
