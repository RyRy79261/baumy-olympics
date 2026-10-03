import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
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

// Issue #128: the calendar (Google) and the shopping list (brain) may take
// seconds when those services start cold, so the page hands them over still
// on their way and they stream in; nothing else waits for them.
describe("HubHome's streamed widgets", () => {
  function widget(html: string, id: string): string {
    const at = html.indexOf(`data-testid="${id}"`);
    expect(at).toBeGreaterThan(-1);
    const start = html.lastIndexOf("<section", at);
    return html.slice(start, html.indexOf("</section>", at));
  }

  const streamed = (
    events: Promise<HubData["events"]>,
    shopping: Promise<HubData["shopping"]>,
  ) => (
    <HubHome
      hub={{ ...hub({ urgent: 1, new: 0, messages: 0 }), events, shopping }}
      memberColors={{}}
      shopping={{ add: vi.fn(), checkOff: vi.fn() }}
    />
  );

  it("shows the rest of the page while the calendar and the list are on their way", () => {
    const never = new Promise<never>(() => {});
    const html = renderToStaticMarkup(streamed(never, never));
    expect(tile(html, "urgent")).toContain('aria-label="Urgent: 1"');
    for (const id of ["widget-events", "widget-shopping"]) {
      const w = widget(html, id);
      expect(w).toContain('data-status="loading"');
      expect(w).toContain('aria-busy="true"');
      expect(w).toContain("Loading…");
    }
  });

  it("fills each one in when its read answers", async () => {
    const stream = await renderToReadableStream(
      streamed(
        Promise.resolve({
          status: "ready",
          data: [
            {
              id: "e1",
              title: "Flat meeting",
              time: "19:00–20:00",
              location: null,
              addedBy: null,
            },
          ],
        }),
        Promise.resolve({ status: "unavailable", message: "Brain is down." }),
      ),
    );
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("Flat meeting");
    expect(html).toContain("Brain is down.");
    expect(widget(html, "widget-events")).toContain('data-status="ready"');
    expect(widget(html, "widget-shopping")).toContain(
      'data-status="unavailable"',
    );
  });
});

// Issue #152: the page's own card (Post a reminder) stacks under Today in the
// wide column, so the short column leaves no gap, in the same order at every
// width.
describe("HubHome's extra card", () => {
  it("sits in the wide column right after Today", () => {
    const html = renderToStaticMarkup(
      <HubHome
        hub={hub({ urgent: 0, new: 0, messages: 0 })}
        memberColors={{}}
        shopping={{ add: vi.fn(), checkOff: vi.fn() }}
      >
        <p data-testid="extra">Post a reminder</p>
      </HubHome>,
    );
    const extra = html.indexOf('data-testid="extra"');
    expect(extra).toBeGreaterThan(html.indexOf('data-testid="widget-events"'));
    expect(extra).toBeLessThan(
      html.indexOf('data-testid="widget-leaderboard"'),
    );
    // No reordering by CSS: what is seen is what is read and tabbed through.
    expect(html).toContain('data-testid="widget-events"');
    expect(html).not.toMatch(/\border-(last|first|none|\d)/);
  });
});
