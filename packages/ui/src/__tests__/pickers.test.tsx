// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CHORE_ICONS, MEMBER_COLORS, MEMBER_COLOR_NAMES } from "@baumy/types";
import { ChoiceGroup } from "../chores";
import {
  CHORE_ICON_LABELS,
  ChoreIconPicker,
  SwatchPicker,
  TilePicker,
  choreIconValue,
  memberColourOptions,
} from "../pickers";
import { GLYPHS } from "../pixel/glyphs";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

const radios = (c: ParentNode, name?: string) => [
  ...c.querySelectorAll<HTMLInputElement>(
    `input[type="radio"]${name ? `[name="${name}"]` : ""}`,
  ),
];
const radio = (c: ParentNode, label: string) =>
  radios(c).find((r) => r.getAttribute("aria-label") === label)!;
const tileOf = (input: HTMLInputElement) => input.closest("label")!;

describe("SwatchPicker", () => {
  const options = memberColourOptions();

  it("is a fieldset of native radios named by colour, never by hex", async () => {
    const c = await mount(
      <SwatchPicker
        legend="Colour"
        name="color"
        value={MEMBER_COLORS[1]}
        onChange={vi.fn()}
        options={options}
      />,
    );
    expect(c.querySelector("fieldset legend")!.textContent).toBe("Colour");
    const all = radios(c, "color");
    expect(all).toHaveLength(MEMBER_COLORS.length);
    expect(all.map((r) => r.getAttribute("aria-label"))).toEqual(
      MEMBER_COLORS.map((col) => MEMBER_COLOR_NAMES[col]),
    );
    expect(all.map((r) => r.value)).toEqual([...MEMBER_COLORS]);
    // The swatch is the colour itself; its hex is never text.
    const swatch = c.querySelector<HTMLElement>(
      `[data-swatch="${MEMBER_COLORS[0]}"]`,
    )!;
    expect(swatch.style.backgroundColor).not.toBe("");
    expect(c.textContent).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("marks only the chosen swatch: thick violet frame and the check", async () => {
    const c = await mount(
      <SwatchPicker
        legend="Colour"
        name="color"
        value={MEMBER_COLORS[1]}
        onChange={vi.fn()}
        options={options}
      />,
    );
    const chosen = radio(c, MEMBER_COLOR_NAMES[MEMBER_COLORS[1]]);
    expect(chosen.checked).toBe(true);
    expect(tileOf(chosen).className).toContain("pixel-frame-4");
    expect(tileOf(chosen).querySelector("[data-check]")).not.toBeNull();
    const other = radio(c, MEMBER_COLOR_NAMES[MEMBER_COLORS[0]]);
    expect(other.checked).toBe(false);
    expect(tileOf(other).className).not.toContain("pixel-frame-4");
    expect(tileOf(other).querySelector("[data-check]")).toBeNull();
    expect(c.querySelectorAll("[data-check]")).toHaveLength(1);
  });

  it("picks on tap, and the keyboard reaches it as one radio group", async () => {
    function Harness() {
      const [v, setV] = useState<string>(MEMBER_COLORS[0]);
      return (
        <form>
          <SwatchPicker
            legend="Colour"
            name="color"
            value={v}
            onChange={setV}
            options={options}
          />
        </form>
      );
    }
    const c = await mount(<Harness />);
    const rose = radio(c, MEMBER_COLOR_NAMES[MEMBER_COLORS[5]]);
    await act(async () => tileOf(rose).click());
    expect(rose.checked).toBe(true);
    expect(radio(c, MEMBER_COLOR_NAMES[MEMBER_COLORS[0]]).checked).toBe(false);
    expect(new FormData(c.querySelector("form")!).get("color")).toBe(
      MEMBER_COLORS[5],
    );
    // Native radios sharing one name, none taken out of the tab order: the
    // browser gives Tab to the group and the arrow keys within it. The ring
    // shows on the tile around the focused, visually hidden radio.
    for (const r of radios(c, "color")) {
      expect(r.tabIndex).not.toBe(-1);
      expect(r.className).toContain("sr-only");
      expect(tileOf(r).className).toContain("pixel-frame-within");
    }
    rose.focus();
    expect(document.activeElement).toBe(rose);
  });

  it("is 44px on the phone and 56px on the kiosk, and can be disabled", async () => {
    const phone = renderToStaticMarkup(
      <SwatchPicker
        legend="Colour"
        name="color"
        value=""
        onChange={vi.fn()}
        options={options}
        describedBy="err"
        testId="colours"
      />,
    );
    expect(phone).toContain("min-h-11 min-w-11");
    expect(phone).toContain('aria-describedby="err"');
    expect(phone).toContain('data-testid="colours"');
    const kiosk = renderToStaticMarkup(
      <SwatchPicker
        legend="Colour"
        name="color"
        value=""
        onChange={vi.fn()}
        options={options}
        kiosk
        disabled
      />,
    );
    expect(kiosk).toContain("min-h-14 min-w-14");
    expect(kiosk).toContain("size-10");
    expect(kiosk.match(/disabled=""/g)).toHaveLength(MEMBER_COLORS.length);
  });
});

describe("memberColourOptions", () => {
  it("offers the member colours, and a colour it does not offer first", () => {
    expect(memberColourOptions().map((o) => o.value)).toEqual([
      ...MEMBER_COLORS,
    ]);
    expect(memberColourOptions(MEMBER_COLORS[2].toUpperCase())).toHaveLength(
      MEMBER_COLORS.length,
    );
    const custom = memberColourOptions("#ABCDEF");
    expect(custom[0]).toEqual({
      value: "#abcdef",
      colour: "#abcdef",
      label: "Custom colour",
    });
    expect(custom).toHaveLength(MEMBER_COLORS.length + 1);
  });
});

describe("TilePicker", () => {
  it("shows captions only when asked, hidden from the accessible name", () => {
    const opts = [{ value: "a", label: "Alpha", tile: <i /> }];
    const without = renderToStaticMarkup(
      <TilePicker
        legend="L"
        name="n"
        value="a"
        onChange={vi.fn()}
        options={opts}
      />,
    );
    expect(without).not.toContain(">Alpha<");
    const withCaptions = renderToStaticMarkup(
      <TilePicker
        legend="L"
        name="n"
        value="b"
        onChange={vi.fn()}
        options={opts}
        captions
      />,
    );
    expect(withCaptions).toContain(">Alpha<");
    expect(withCaptions).toContain('aria-label="Alpha"');
  });
});

describe("ChoreIconPicker", () => {
  it("offers every chore icon as its glyph, each a glyph the kit has", async () => {
    for (const icon of CHORE_ICONS) expect(GLYPHS[icon]).toBeDefined();
    const c = await mount(
      <ChoreIconPicker sprite="bin" value="bin" onChange={vi.fn()} />,
    );
    const all = radios(c, "sprite");
    expect(all.map((r) => r.value)).toEqual([...CHORE_ICONS]);
    expect(all.map((r) => r.getAttribute("aria-label"))).toEqual(
      CHORE_ICONS.map((i) => CHORE_ICON_LABELS[i]),
    );
    expect(radio(c, "Bin").checked).toBe(true);
    for (const r of all) expect(tileOf(r).querySelector("svg")).not.toBeNull();
  });

  it("keeps a starter chore's sprite unless another icon is picked", async () => {
    expect(choreIconValue("trash")).toBe("");
    expect(choreIconValue("plant")).toBe("plant");
    expect(choreIconValue(undefined)).toBe("");
    const c = await mount(
      <ChoreIconPicker sprite="trash" value="" onChange={vi.fn()} />,
    );
    const keep = radio(c, "Current icon");
    expect(keep.value).toBe("");
    expect(keep.checked).toBe(true);
    const fresh = renderToStaticMarkup(
      <ChoreIconPicker value="" onChange={vi.fn()} />,
    );
    expect(fresh).toContain('aria-label="Automatic"');
  });
});

// React 19 resets a form after its action; a reset puts radios back to their
// page-load `checked`. The groups keep the pick in state, so the form must
// still post it, or the next save quietly stores the old value.
describe("after the form resets", () => {
  async function resetForm(c: HTMLElement) {
    await act(async () => {
      c.querySelector("form")!.reset();
    });
  }

  it("a TilePicker's form still posts the chosen tile", async () => {
    function Harness() {
      const [v, setV] = useState<string>(MEMBER_COLORS[0]);
      return (
        <form>
          <SwatchPicker
            legend="Colour"
            name="color"
            value={v}
            onChange={setV}
            options={memberColourOptions()}
          />
          <input name="note" defaultValue="kept" />
        </form>
      );
    }
    const c = await mount(<Harness />);
    const rose = radio(c, MEMBER_COLOR_NAMES[MEMBER_COLORS[5]]);
    await act(async () => tileOf(rose).click());
    await resetForm(c);
    const data = new FormData(c.querySelector("form")!);
    expect(data.get("note")).toBe("kept");
    expect(data.get("color")).toBe(MEMBER_COLORS[5]);
    expect(rose.checked).toBe(true);
    expect(radio(c, MEMBER_COLOR_NAMES[MEMBER_COLORS[0]]).checked).toBe(false);
  });

  it("a ChoiceGroup's form still posts the chosen option", async () => {
    function Harness() {
      const [v, setV] = useState("a");
      return (
        <form>
          <ChoiceGroup
            legend="Who did it?"
            name="doneBy"
            value={v}
            onChange={setV}
            options={[
              { value: "a", label: "Ryan" },
              { value: "b", label: "Partner" },
            ]}
          />
        </form>
      );
    }
    const c = await mount(<Harness />);
    const b = radios(c, "doneBy").find((r) => r.value === "b")!;
    await act(async () => b.closest("label")!.click());
    expect(new FormData(c.querySelector("form")!).get("doneBy")).toBe("b");
    await resetForm(c);
    expect(new FormData(c.querySelector("form")!).get("doneBy")).toBe("b");
  });
});
