import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckItemButton, CheckList } from "../check-list";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("CheckList", () => {
  it("is a list of rows", () => {
    const out = html(
      <CheckList data-testid="list">
        <li>milk</li>
      </CheckList>,
    );
    expect(out).toContain(
      '<ul class="flex flex-col gap-2" data-testid="list">',
    );
    expect(out).toContain("<li>milk</li>");
  });
});

describe("CheckItemButton", () => {
  it("submits by default and names what it checks off", () => {
    const out = html(<CheckItemButton label="Oat milk" />);
    expect(out).toContain('type="submit"');
    expect(out).toContain('aria-label="Check off Oat milk"');
    expect(out).toContain(">Oat milk</span>");
    expect(out).toContain("min-h-11");
    expect(out).not.toContain("min-h-14");
  });

  it("is a 56px target on the kiosk", () => {
    const out = html(
      <CheckItemButton label="Eggs" kiosk type="button" disabled />,
    );
    expect(out).toContain("min-h-14");
    expect(out).toContain('type="button"');
    expect(out).toContain("disabled");
  });
});
