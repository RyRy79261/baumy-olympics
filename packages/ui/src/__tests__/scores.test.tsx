import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Points, Stat, StreakFlame, Table, Td, Th } from "../scores";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Table", () => {
  it("renders a scrollable table with a hidden caption and aligned numbers", () => {
    const out = html(
      <Table caption="Standings">
        <thead>
          <tr>
            <Th>Member</Th>
            <Th numeric>Points</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>Ryan</Td>
            <Td numeric>20</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain('<caption class="sr-only">Standings</caption>');
    expect(out).toContain('scope="col"');
    expect(out).toContain("text-right font-mono");
  });

  it("has no caption unless given one", () => {
    expect(html(<Table />)).not.toContain("caption");
  });
});

describe("Points", () => {
  it("dims the provisional part and says it in words", () => {
    const out = html(<Points points={45} provisional={20} />);
    expect(out).toContain(">45<");
    expect(out).toContain("data-provisional");
    expect(out).toContain("opacity-50");
    expect(out).toContain("(20 pending)");
  });

  it("shows nothing dimmed when every point is final", () => {
    const out = html(<Points points={45} />);
    expect(out).toContain(">45<");
    expect(out).not.toContain("pending");
  });
});

describe("StreakFlame", () => {
  it("burns for a run still going, and is out for a broken one", () => {
    const burning = html(<StreakFlame length={4} />);
    expect(burning).toContain('data-state="burning"');
    expect(burning).toContain('data-streak="4"');
    expect(burning).toContain("still going");
    const out = html(<StreakFlame length={9} current={false} />);
    expect(out).toContain('data-state="out"');
    expect(out).not.toContain("still going");
  });
});

describe("Stat", () => {
  it("shows a label, a big value and an optional hint", () => {
    expect(html(<Stat label="Pot" value="€80.50" hint="Since Jan" />)).toMatch(
      /Pot.*€80\.50.*Since Jan/,
    );
    expect(html(<Stat label="Pot" value="€0" />)).not.toContain("text-sm");
  });
});
