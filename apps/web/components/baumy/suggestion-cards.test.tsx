import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/ai/proposal";
import { rowsFor, type ReviewRow } from "@/lib/ai/review";
import { SuggestionCards, type SuggestionCardsProps } from "./suggestion-cards";

// The suggestion cards (SPEC §3.6, owner ruling 2026-09-29, issue #107):
// exactly two main buttons, Confirm all and Cancel; × drops one card; a
// destructive card is red, an invalid one greyed with its reason; the PIN
// is asked once on the kiosk; results show per card.

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

let n = 0;
function proposal(over: Partial<Proposal> = {}): Proposal {
  n += 1;
  return {
    proposalId: `p-${n}`,
    name: "create_bounty",
    title: "Add a bounty",
    input: {},
    preview: `New bounty: Card ${n} · maintenance · 15 pts`,
    risk: "confirm",
    valid: true,
    needsPin: false,
    fields: [],
    ...over,
  };
}

function mount(rows: ReviewRow[], over: Partial<SuggestionCardsProps> = {}) {
  const props: SuggestionCardsProps = {
    rows,
    kiosk: false,
    pinLabel: "Ryan's PIN",
    busy: false,
    onConfirmAll: vi.fn(),
    onCancel: vi.fn(),
    onDone: vi.fn(),
    onDrop: vi.fn(),
    ...over,
  };
  const div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  act(() => root!.render(<SuggestionCards {...props} />));
  return props;
}

const buttons = () =>
  [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  )!;
const cards = () => [
  ...document.querySelectorAll<HTMLElement>("li[data-testid^=suggestion-]"),
];

describe.each([false, true])("SuggestionCards (bubble: %s)", (bubble) => {
  it("shows one card per suggestion and exactly Confirm all and Cancel", () => {
    const a = proposal();
    const b = proposal({
      name: "add_pot_contribution",
      preview: "Add €20 to the pot",
    });
    const props = mount(rowsFor([a, b]), { bubble });
    expect(cards()).toHaveLength(2);
    expect(document.body.textContent).toContain(a.preview);
    expect(document.body.textContent).toContain("Add €20 to the pot");
    const main = buttons().filter((t) => t !== "×" && t !== "Edit");
    expect(main).toEqual(["Confirm all", "Cancel"]);
    act(() => button("Confirm all").click());
    expect(props.onConfirmAll).toHaveBeenCalledWith();
    act(() => button("Cancel").click());
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("drops one card with its ×, and hides dropped cards", () => {
    const rows = rowsFor([proposal(), proposal()]);
    const props = mount(rows, { bubble });
    const drop = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Drop: ${rows[1]!.proposal.preview}"]`,
    )!;
    act(() => drop.click());
    expect(props.onDrop).toHaveBeenCalledWith(rows[1]);

    act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
    mount([rows[0]!, { ...rows[1]!, state: "rejected" }], { bubble });
    expect(cards()).toHaveLength(1);
    expect(document.body.textContent).toContain(rows[0]!.proposal.preview);
    expect(document.body.textContent).not.toContain(rows[1]!.proposal.preview);
  });

  it("marks a destructive card red and greys an invalid one with its reason", () => {
    const del = proposal({
      name: "delete_note",
      risk: "destructive",
      preview: "Delete the note Wifi password",
    });
    const bad = proposal({
      valid: false,
      error: "Only a household admin can do this.",
    });
    mount(rowsFor([del, bad]), { bubble });
    const [red, grey] = cards();
    expect(red!.dataset.tone).toBe("destructive");
    expect(red!.textContent).toContain("Deletes something");
    expect(grey!.dataset.tone).toBe("invalid");
    expect(grey!.textContent).toContain("Only a household admin can do this.");
    expect(grey!.textContent).toContain("Can't do this");
  });

  it("cannot confirm when every card is invalid, but can cancel", () => {
    mount(rowsFor([proposal({ valid: false, error: "No." })]), { bubble });
    expect(button("Confirm all").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
  });

  it("shows each card's result, and one Done once nothing is left to run", () => {
    const [a, b] = rowsFor([proposal(), proposal()]);
    const props = mount(
      [
        { ...a!, state: "saved", message: "Saved." },
        {
          ...b!,
          state: "failed",
          message: "There is already a chore called X.",
        },
      ],
      { bubble },
    );
    expect(document.body.textContent).toContain("Saved.");
    expect(document.body.textContent).toContain(
      "There is already a chore called X.",
    );
    // The failed one can run again.
    expect(buttons()).toContain("Confirm all");

    act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
    const done = mount([{ ...a!, state: "saved", message: "Saved." }], {
      bubble,
      onDone: props.onDone,
    });
    expect(buttons()).not.toContain("Confirm all");
    act(() => button("Done").click());
    expect(done.onDone).toHaveBeenCalled();
  });

  it("asks the kiosk PIN once, then confirms all with it", () => {
    const rows = rowsFor([
      proposal(),
      proposal({ name: "log_completion", needsPin: true }),
      proposal({ name: "log_completion", needsPin: true }),
    ]);
    const props = mount(rows, { bubble, kiosk: true });
    expect(document.body.textContent).toContain("Needs your PIN");
    act(() => button("Confirm all").click());
    expect(props.onConfirmAll).not.toHaveBeenCalled();
    const pad = document.querySelector<HTMLFormElement>(
      'form[aria-label="Ryan\'s PIN"]',
    )!;
    expect(pad).not.toBeNull();
    for (const d of ["1", "2", "3", "4"]) act(() => button(d).click());
    act(() => pad.requestSubmit());
    expect(props.onConfirmAll).toHaveBeenCalledTimes(1);
    expect(props.onConfirmAll).toHaveBeenCalledWith("1234");
    expect(document.querySelector('form[aria-label="Ryan\'s PIN"]')).toBeNull();
  });

  it("confirms without a PIN off the kiosk, and while busy says Saving", () => {
    const props = mount(rowsFor([proposal({ needsPin: true })]), { bubble });
    act(() => button("Confirm all").click());
    expect(props.onConfirmAll).toHaveBeenCalledWith();

    act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
    mount(rowsFor([proposal()]), { bubble, busy: true });
    expect(button("Saving…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
  });
});
