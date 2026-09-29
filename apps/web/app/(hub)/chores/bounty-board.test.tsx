import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { SuggestionView } from "@/lib/actions/weights";

// The Bounties page's edit dialog for an admin (issue #109): the same fields
// as /admin/chores minus points and cooldown, which change only through
// Change points (a scheduled weight change), and a link to /admin/chores for
// archiving.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(hub)/admin/chores/actions", () => ({
  manageChoreAction: vi.fn(),
}));
vi.mock("@/app/(hub)/admin/weights/actions", () => ({
  scheduleWeightAction: vi.fn(),
  dismissWeightAction: vi.fn(),
  vetoWeightAction: vi.fn(),
}));

const { BountyBoard } = await import("./bounty-board");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has <dialog> without the modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

const chore: ChoreView = {
  id: "c-1",
  name: "Trash",
  sprite: "trash",
  kind: "maintenance",
  proofMode: "none",
  confirmMode: "optimistic",
  effortFactorPct: 100,
  archived: false,
  basePoints: 40,
  cooldownMinutes: 24 * 60,
  intervalMinutes: 3 * 24 * 60,
  streak: null,
  lastDoneAt: null,
  state: "due",
  availableAt: null,
  dueAt: null,
  urgent: false,
  isNew: false,
  createdAt: "2026-09-01T10:00:00.000Z",
  next: null,
};

const suggestion: SuggestionView = {
  id: "s-1",
  choreId: chore.id,
  status: "open",
  computedAt: "2026-09-28T02:00:00.000Z",
  sampleIntervals: [60, 60, 60, 60, 60, 60],
  medianIntervalMinutes: 60,
  rawPoints: 29.5,
  currentPoints: 40,
  currentCooldownMinutes: 24 * 60,
  suggestedPoints: 30,
  suggestedCooldownMinutes: 24 * 60,
  scheduledPoints: null,
  scheduledCooldownMinutes: null,
  appliesAt: null,
  scheduledBy: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(suggestions: SuggestionView[] | null) {
  act(() =>
    root.render(
      <BountyBoard
        admin={suggestions ? { suggestions } : null}
        chores={[chore]}
        members={[{ id: "m-1", displayName: "Ryan" }]}
        actorId="m-1"
        action={vi.fn()}
      />,
    ),
  );
}

function button(name: string, within: ParentNode = container) {
  return [...within.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
}

function openEdit(): HTMLDialogElement {
  const edit = button("Edit Trash");
  expect(edit).toBeDefined();
  act(() => edit!.click());
  const dialog = container.querySelector<HTMLDialogElement>(
    'dialog[aria-label="Edit Trash"]',
  );
  expect(dialog).not.toBeNull();
  return dialog!;
}

describe("BountyBoard", () => {
  it("has no Edit button for a member", () => {
    render(null);
    expect(
      container.querySelector('[data-testid="chore-Trash"]'),
    ).not.toBeNull();
    expect(button("Edit Trash")).toBeUndefined();
  });

  it("edits a bounty without its points and cooldown, and links to more options", () => {
    render([]);
    const dialog = openEdit();
    expect(dialog.querySelector('input[name="name"]')).not.toBeNull();
    expect(dialog.querySelector('select[name="kind"]')).not.toBeNull();
    expect(dialog.querySelector('input[name="basePoints"]')).toBeNull();
    expect(dialog.querySelector('input[name="cooldownHours"]')).toBeNull();
    const points = dialog.querySelector('[data-testid="bounty-points"]')!;
    expect(points.textContent).toContain("40 pts");
    expect(points.textContent).toContain("cooldown 24h");
    const more = dialog.querySelector('a[href="/admin/chores"]');
    expect(more?.textContent).toBe("More options");
  });

  it("Change points offers the week's suggestion to schedule, explaining the veto", () => {
    render([suggestion]);
    const dialog = openEdit();
    expect(
      dialog.querySelector('form[aria-label="Schedule Trash"]'),
    ).toBeNull();
    act(() => button("Change points", dialog)!.click());
    const form = dialog.querySelector('form[aria-label="Schedule Trash"]');
    expect(form).not.toBeNull();
    expect(
      form!.querySelector<HTMLInputElement>('input[name="basePoints"]')!.value,
    ).toBe("30");
    expect(dialog.textContent).toContain("40 → 30 pts");
    expect(dialog.textContent).toContain("unless another member vetoes it");
    expect(button("Change points", dialog)).toBeUndefined();
  });

  it("Change points says no change is due without a suggestion", () => {
    render([]);
    const dialog = openEdit();
    act(() => button("Change points", dialog)!.click());
    expect(
      dialog.querySelector('[data-testid="no-suggestion"]')?.textContent,
    ).toContain("No change is due yet.");
    expect(
      dialog.querySelector('form[aria-label="Schedule Trash"]'),
    ).toBeNull();
  });

  it("shows a scheduled change with Cancel instead of Change points", () => {
    render([
      {
        ...suggestion,
        status: "scheduled",
        scheduledPoints: 32,
        scheduledCooldownMinutes: 24 * 60,
        appliesAt: "2026-10-05T22:00:00.000Z",
        scheduledBy: "m-1",
      },
    ]);
    const dialog = openEdit();
    expect(dialog.textContent).toContain("Scheduled: 40 → 32 pts");
    expect(button("Cancel the Trash change", dialog)).toBeDefined();
    expect(button("Change points", dialog)).toBeUndefined();
  });
});
