import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #152: the hub frame mounts Baumy in its top bar, docked, and only
// the home shows it, as before.

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/components/baumy/baumy-sheet", () => ({
  BaumySheet: (p: { voice: boolean; docked?: boolean }) => (
    <p data-testid="sheet" data-voice={p.voice} data-docked={p.docked} />
  ),
}));

const { HubBaumy } = await import("./hub-baumy");

beforeEach(() => {
  pathname = "/";
});

describe("HubBaumy", () => {
  it("shows the docked Baumy on the home, with voice as configured", () => {
    const out = renderToStaticMarkup(<HubBaumy voice />);
    expect(out).toContain('data-testid="sheet"');
    expect(out).toContain('data-voice="true"');
    expect(out).toContain('data-docked="true"');
  });

  it("shows nothing on the other hub pages", () => {
    expect(renderToStaticMarkup(<HubBaumy voice={false} />)).toContain("sheet");
    pathname = "/chores";
    expect(renderToStaticMarkup(<HubBaumy voice={false} />)).toBe("");
  });
});
