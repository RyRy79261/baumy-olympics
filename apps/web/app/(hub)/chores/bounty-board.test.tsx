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
import type { PointsHistoryView, SuggestionView } from "@/lib/actions/weights";

// The Bounties page's edit dialog for an admin (issue #109): the same fields
// as /admin/chores minus points and cooldown, which change only through
// Change points (any points, scheduled: schedule_points_change, issue #115),
// the bounty's points history, and a link to /admin/chores for archiving.

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
  schedulePointsChangeAction: vi.fn(),
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
  origin: "measured",
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
  reason: null,
  appliesAt: null,
  scheduledBy: null,
};

const vetoed: PointsHistoryView = {
  key: "s:s-0",
  choreId: chore.id,
  choreName: chore.name,
  source: "admin",
  suggestionId: "s-0",
  proposedBy: { memberId: "m-1", displayName: "Ryan" },
  proposedAt: "2026-09-21T08:00:00.000Z",
  fromPoints: 40,
  fromCooldownMinutes: 24 * 60,
  toPoints: 60,
  toCooldownMinutes: 24 * 60,
  reason: "Twice the work",
  appliesAt: "2026-09-27T22:00:00.000Z",
  outcome: "vetoed",
  decidedBy: { memberId: "m-2", displayName: "Partner" },
  decidedAt: "2026-09-22T08:00:00.000Z",
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

function render(
  suggestions: SuggestionView[] | null,
  history: PointsHistoryView[] = [],
) {
  act(() =>
    root.render(
      <BountyBoard
        admin={suggestions ? { suggestions, history } : null}
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

  it("Change points starts at the week's suggestion, explaining the veto", () => {
    render([suggestion]);
    const dialog = openEdit();
    const formName = 'form[aria-label="Change Trash\'s points"]';
    expect(dialog.querySelector(formName)).toBeNull();
    act(() => button("Change points", dialog)!.click());
    const form = dialog.querySelector(formName);
    expect(form).not.toBeNull();
    expect(
      form!.querySelector<HTMLInputElement>('input[name="basePoints"]')!.value,
    ).toBe("30");
    expect(
      form!.querySelector<HTMLInputElement>('input[name="choreId"]')!.value,
    ).toBe(chore.id);
    expect(form!.querySelector('textarea[name="reason"]')).not.toBeNull();
    expect(
      dialog.querySelector('[data-testid="open-suggestion"]')?.textContent,
    ).toContain("40 → 30 pts");
    expect(dialog.textContent).toContain("unless another member vetoes them");
    expect(button("Change points", dialog)).toBeUndefined();
  });

  it("Change points takes any points without a suggestion, starting at the current ones", () => {
    render([]);
    const dialog = openEdit();
    act(() => button("Change points", dialog)!.click());
    const form = dialog.querySelector(
      'form[aria-label="Change Trash\'s points"]',
    );
    expect(form).not.toBeNull();
    expect(
      form!.querySelector<HTMLInputElement>('input[name="basePoints"]')!.value,
    ).toBe("40");
    expect(
      form!.querySelector<HTMLInputElement>('input[name="cooldownHours"]')!
        .value,
    ).toBe("24");
    expect(dialog.querySelector('[data-testid="open-suggestion"]')).toBeNull();
  });

  it("shows the bounty's points history, or that there is none", () => {
    render([], [vetoed]);
    const dialog = openEdit();
    const history = dialog.querySelector(
      '[data-testid="bounty-points-history"]',
    )!;
    const change = history.querySelector('[data-testid="points-change"]');
    expect(change?.getAttribute("data-outcome")).toBe("vetoed");
    expect(change?.textContent).toContain("40 → 60 pts");
    expect(change?.textContent).toContain("Twice the work");
    expect(change?.textContent).toContain("Vetoed by Partner");
    act(() => button("Cancel", dialog)!.click());

    render([]);
    const empty = openEdit();
    expect(
      empty.querySelector('[data-testid="points-history-empty"]')?.textContent,
    ).toBe("No changes yet.");
    expect(empty.querySelector('[data-testid="points-change"]')).toBeNull();
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
