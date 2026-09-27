import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sparkline } from "../sparkline";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Sparkline", () => {
  it("draws the series as a labelled line, low values at the bottom", () => {
    const out = html(
      <Sparkline values={[1, 3, 2]} label="Gaps" width={24} height={10} />,
    );
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Gaps"');
    expect(out).toContain('data-points="3"');
    // x from 2 to 22; the 1 at the bottom (y 8), the 3 at the top (y 2).
    expect(out).toContain('points="2.0,8.0 12.0,2.0 22.0,5.0"');
  });

  it("puts a flat series in the middle", () => {
    const out = html(
      <Sparkline values={[4, 4]} label="Flat" width={24} height={10} />,
    );
    expect(out).toContain('points="2.0,5.0 22.0,5.0"');
  });

  it("draws no line for fewer than two values", () => {
    for (const values of [[], [5]]) {
      const out = html(<Sparkline values={values} label="Empty" />);
      expect(out).toContain('aria-label="Empty"');
      expect(out).not.toContain("polyline");
    }
  });
});
