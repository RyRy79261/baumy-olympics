import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HubData } from "@/lib/hub/load";

// The hub home's status tiles (ADR 0005 §1, issue #67): a count links to its
// slice with a badge, a zero goes dim, and a count that could not be read
// says so instead of pretending to be zero.

vi.mock("@/components/baumy/baumy-sheet", () => ({ BaumySheet: () => null }));
vi.mock("@/components/shopping/shopping-list", () => ({
  ShoppingList: () => null,
}));

const { HubHome } = await import("./hub-home");

const empty = { status: "empty", message: "Nothing." } as const;

function hub(counts: HubData["counts"]): HubData {
  return {
    now: "2026-09-28T10:00:00.000Z",
    events: empty,
    chores: empty,
    standings: empty,
    pot: { ok: true, total: "€0.00" },
    notes: empty,
    counts,
    shopping: { status: "ready", data: [] },
  };
}

function tile(html: string, key: string): string {
  const start = html.indexOf(`data-testid="hub-tile-${key}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</a>", start));
}

const render = (counts: HubData["counts"]) =>
  renderToStaticMarkup(
    <HubHome
      hub={hub(counts)}
      memberColors={{}}
      shopping={{ add: vi.fn(), checkOff: vi.fn() }}
    />,
  );

describe("HubHome's status tiles", () => {
  it("badges a count and links it to its slice; a zero is dim with no badge", () => {
    const html = render({ urgent: 3, new: 0, messages: 1 });
    const urgent = tile(html, "urgent");
    expect(urgent).toContain('aria-label="Urgent: 3"');
    expect(urgent).toContain('href="/chores?show=urgent"');
    expect(urgent).toContain("data-count");
    const fresh = tile(html, "new");
    expect(fresh).toContain('aria-label="New: 0"');
    expect(fresh).not.toContain("data-count");
    expect(fresh).not.toContain("data-unavailable");
    expect(tile(html, "messages")).toContain('href="/notes"');
  });

  it("says a count it could not read is unavailable, never zero", () => {
    const html = render({ urgent: null, new: 2, messages: null });
    const urgent = tile(html, "urgent");
    expect(urgent).toContain('aria-label="Urgent: unavailable"');
    expect(urgent).toContain("data-unavailable");
    expect(urgent).not.toContain("data-count");
    expect(tile(html, "messages")).toContain(
      'aria-label="Messages: unavailable"',
    );
    expect(tile(html, "new")).toContain("data-count");
  });
});
