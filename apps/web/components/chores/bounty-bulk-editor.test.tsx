import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_POINTS_MAX } from "@baumy/types";
import type { ActionResult } from "@/lib/actions/result";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";
import { CHANGES_FIELD, EFFORT_STOPS } from "@/lib/chores/bulk-edit";
import { BountyBulkEditor, type BulkEditorBounty } from "./bounty-bulk-editor";

// The mass bounty editor (issue #175): one row per bounty, changed rows
// marked, one Save that sends only what changed, Discard, the action's
// errors inline, and on the kitchen screen the PIN pad for the one save.

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ui/toast", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  toastSuccess.mockReset();
});

const BOUNTIES: BulkEditorBounty[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Trash",
    sprite: "bin",
    kind: "maintenance",
    proofMode: "none",
    effortFactorPct: 100,
    basePoints: 20,
    cooldownMinutes: 24 * 60,
    archived: false,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Dishes",
    sprite: "soap",
    kind: "maintenance",
    proofMode: "optional",
    effortFactorPct: 100,
    basePoints: 10,
    cooldownMinutes: 12 * 60,
    archived: false,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Fridge",
    sprite: "fridge",
    kind: "maintenance",
    proofMode: "none",
    effortFactorPct: 100,
    basePoints: 30,
    cooldownMinutes: 7 * 24 * 60,
    archived: true,
  },
];

type Result = ActionResult<UpdateBountiesData>;

async function mount(
  result: Result,
  opts: { pinLabel?: string; onClose?: () => void } = {},
) {
  const action = vi.fn(async (_prev: Result | null, _form: FormData) => result);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root!.render(
      <BountyBulkEditor bounties={BOUNTIES} action={action} {...opts} />,
    ),
  );
  return { el, action };
}

/** Mount with a given action and list; `rerender` gives a new list. */
async function mountWith(
  action: (prev: Result | null, form: FormData) => Promise<Result>,
  opts: { pinLabel?: string } = {},
  bounties: BulkEditorBounty[] = BOUNTIES,
) {
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  const render = (list: BulkEditorBounty[]) =>
    act(async () =>
      root!.render(
        <BountyBulkEditor bounties={list} action={action} {...opts} />,
      ),
    );
  await render(bounties);
  return { el, rerender: render };
}

const row = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLElement>(`[data-testid="bulk-bounty-${name}"]`)!;
const control = <T extends HTMLElement>(
  el: HTMLElement,
  name: string,
  label: string,
) => {
  const r = row(el, name);
  const lab = [...r.querySelectorAll("label")].find(
    (l) => l.textContent === label,
  )!;
  return r.querySelector<T>(`#${CSS.escape(lab.htmlFor)}`)!;
};

/** Set a controlled input's or select's value as a user would. */
async function set(
  target: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    target instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(target, value);
    target.dispatchEvent(
      new Event(target instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

const button = (el: HTMLElement, text: string | RegExp) =>
  [...el.querySelectorAll("button")].find((b) =>
    typeof text === "string"
      ? b.textContent === text
      : text.test(b.textContent!),
  )!;

/** A slider's value in words, as it is read out. */
const said = (input: HTMLInputElement) => input.getAttribute("aria-valuetext");

/** Press a key on a slider. */
async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

/** Move a slider with the arrow keys until it says `text`. */
async function slideTo(input: HTMLInputElement, text: string) {
  await press(input, "Home");
  for (let i = 0; said(input) !== text; i++) {
    if (i > 250) throw new Error(`The slider never said ${text}.`);
    await press(input, "ArrowRight");
  }
}

/** A bounty with no points yet: no points, no cooldown. */
const SHELF: BulkEditorBounty = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Shelf",
  sprite: "box",
  kind: "maintenance",
  proofMode: "none",
  effortFactorPct: 123,
  basePoints: null,
  cooldownMinutes: null,
  archived: false,
};

async function editTwo(el: HTMLElement) {
  await press(control<HTMLInputElement>(el, "Trash", "Points"), "End");
  await set(control<HTMLInputElement>(el, "Dishes", "Name"), "Plates");
  await set(control<HTMLSelectElement>(el, "Fridge", "Status"), "active");
}

const sentChanges = (action: ReturnType<typeof vi.fn>) =>
  JSON.parse(
    (action.mock.calls[0]![1] as FormData).get(CHANGES_FIELD) as string,
  );

const OK: Result = {
  ok: true,
  data: {
    changed: BOUNTIES.map((b) => ({
      choreId: b.id,
      name: b.name,
      archived: false,
      weightChanged: false,
    })),
  },
};

describe("BountyBulkEditor", () => {
  it("shows one row per bounty, with nothing to save until a row changes", async () => {
    const { el } = await mount(OK);
    for (const b of BOUNTIES) expect(row(el, b.name)).not.toBeNull();
    expect(said(control<HTMLInputElement>(el, "Trash", "Points"))).toBe(
      "20 pts",
    );
    expect(said(control<HTMLInputElement>(el, "Trash", "Cooldown (h)"))).toBe(
      "24 h · 1 day",
    );
    expect(said(control<HTMLInputElement>(el, "Fridge", "Cooldown (h)"))).toBe(
      "168 h · 7 days",
    );
    expect(said(control<HTMLInputElement>(el, "Trash", "Effort (%)"))).toBe(
      "100%",
    );
    // The value is written next to each slider too.
    expect(row(el, "Trash").textContent).toContain("20 pts");
    expect(control<HTMLSelectElement>(el, "Fridge", "Status").value).toBe(
      "archived",
    );
    expect(el.textContent).toContain("No changes yet.");
    expect(button(el, "Save changes").disabled).toBe(true);
    expect(el.querySelector("[data-changed]")).toBeNull();
  });

  it("marks the changed rows and saves only what changed, in one request", async () => {
    const onClose = vi.fn();
    const { el, action } = await mount(OK, { onClose });
    await editTwo(el);
    expect(row(el, "Trash").dataset.changed).toBe("true");
    expect(row(el, "Trash").textContent).toContain("Changed");
    expect(row(el, "Dishes").dataset.changed).toBe("true");
    expect(row(el, "Fridge").dataset.changed).toBe("true");
    expect(el.textContent).toContain("3 bounties changed, not saved yet.");
    // Changing a row back makes it unchanged again.
    await set(control<HTMLSelectElement>(el, "Fridge", "Status"), "archived");
    expect(row(el, "Fridge").dataset.changed).toBeUndefined();

    const save = button(el, "Save 2 changes");
    expect(save.disabled).toBe(false);
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(action).toHaveBeenCalledTimes(1);
    expect(sentChanges(action)).toEqual([
      { choreId: BOUNTIES[0]!.id, points: BASE_POINTS_MAX },
      { choreId: BOUNTIES[1]!.id, name: "Plates" },
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("Saved 3 bounties.");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(el.querySelector("[data-changed]")).toBeNull();
  });

  it("discards every change, and closes when there is nothing to discard", async () => {
    const onClose = vi.fn();
    const { el, action } = await mount(OK, { onClose });
    await editTwo(el);
    expect(el.querySelector("[data-changed]")).not.toBeNull();
    await act(async () => button(el, "Discard").click());
    expect(el.querySelector("[data-changed]")).toBeNull();
    expect(control<HTMLInputElement>(el, "Dishes", "Name").value).toBe(
      "Dishes",
    );
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => button(el, "Close").click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it("shows a field's error under it on its own row, and keeps the edits", async () => {
    const { el } = await mount({
      ok: false,
      code: "INVALID_INPUT",
      message: "Some of that is not valid. Check it and try again.",
      issues: [
        { path: ["changes", 1, "name"], message: "Give the chore a name." },
      ],
    });
    await editTwo(el);
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(row(el, "Dishes").textContent).toContain("Give the chore a name.");
    expect(row(el, "Trash").textContent).not.toContain(
      "Give the chore a name.",
    );
    expect(el.querySelector('[role="alert"]')!.textContent).toBe(
      "Some rows need fixing; see the red notes.",
    );
    expect(row(el, "Dishes").dataset.changed).toBe("true");
  });

  it("says why the save failed when it is not about one field", async () => {
    const { el } = await mount({
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message: "There is already a chore called Plates. Pick another name.",
    });
    await editTwo(el);
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(el.querySelector('[role="alert"]')!.textContent).toBe(
      "There is already a chore called Plates. Pick another name.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(row(el, "Trash").dataset.changed).toBe("true");
  });

  it("on the kitchen screen, asks the admin's PIN for the one save", async () => {
    const { el, action } = await mount(
      {
        ok: false,
        code: "ATTESTATION_REQUIRED",
        message: "Enter your PIN to do this.",
      },
      { pinLabel: "Ryan's PIN" },
    );
    // Touch-sized controls.
    expect(
      control<HTMLInputElement>(el, "Trash", "Points").className,
    ).toContain("min-h-14");
    expect(button(el, "Save changes").disabled).toBe(true);
    expect(button(el, "Discard").disabled).toBe(true);
    await editTwo(el);
    await act(async () => button(el, "Save 3 changes").click());
    expect(action).toHaveBeenCalledTimes(1);
    expect(sentChanges(action)).toHaveLength(3);
    expect(
      el.querySelector('[role="group"][aria-label="Ryan\'s PIN"]'),
    ).not.toBeNull();
    // Asking for the PIN is not an error, and the edits stay.
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(row(el, "Trash").dataset.changed).toBe("true");
  });

  it("keeps showing the edits after the form's answer resets it (a list too)", async () => {
    const { el } = await mount(
      {
        ok: false,
        code: "ATTESTATION_REQUIRED",
        message: "Enter your PIN to do this.",
      },
      { pinLabel: "Ryan's PIN" },
    );
    await set(control<HTMLSelectElement>(el, "Trash", "Kind"), "consumable");
    await slideTo(control<HTMLInputElement>(el, "Trash", "Points"), "7 pts");
    await act(async () => button(el, "Save 1 change").click());
    // React resets a form after its action answers; the rows are not part
    // of it, so what they show is still what will be sent.
    expect(control<HTMLSelectElement>(el, "Trash", "Kind").value).toBe(
      "consumable",
    );
    expect(said(control<HTMLInputElement>(el, "Trash", "Points"))).toBe(
      "7 pts",
    );
  });

  it("sends a slider's number, marks its row, and moving it back clears both", async () => {
    const action = vi.fn(async (_p: Result | null, _f: FormData) => OK);
    const { el } = await mountWith(action);
    const cooldown = control<HTMLInputElement>(el, "Trash", "Cooldown (h)");
    // 24 h, then six-hour steps: 30, 36 … 84.
    for (let i = 0; i < 10; i++) await press(cooldown, "ArrowRight");
    expect(said(cooldown)).toBe("84 h · 3.5 days");
    expect(row(el, "Trash").textContent).toContain("84 h · 3.5 days");
    expect(row(el, "Trash").dataset.changed).toBe("true");
    for (let i = 0; i < 10; i++) await press(cooldown, "ArrowLeft");
    expect(said(cooldown)).toBe("24 h · 1 day");
    expect(row(el, "Trash").dataset.changed).toBeUndefined();
    expect(el.textContent).toContain("No changes yet.");
    const effort = control<HTMLInputElement>(el, "Dishes", "Effort (%)");
    await press(effort, "ArrowRight");
    expect(said(effort)).toBe("105%");
    await press(cooldown, "PageUp");
    expect(said(cooldown)).toBe("84 h · 3.5 days");
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(sentChanges(action)).toEqual([
      { choreId: BOUNTIES[0]!.id, cooldownHours: 84 },
      { choreId: BOUNTIES[1]!.id, effortFactorPct: 105 },
    ]);
  });

  it("steps the points one at a time with − and +, held to their limits (§12 decision 33)", async () => {
    const action = vi.fn(async (_p: Result | null, _f: FormData) => OK);
    const { el } = await mountWith(action, {}, [...BOUNTIES, SHELF]);
    const less = (name: string) =>
      el.querySelector<HTMLButtonElement>(
        `button[aria-label="One point less for ${name}"]`,
      )!;
    const more = (name: string) =>
      el.querySelector<HTMLButtonElement>(
        `button[aria-label="One point more for ${name}"]`,
      )!;
    const points = control<HTMLInputElement>(el, "Trash", "Points");
    expect(more("Trash").textContent).toBe("+");
    expect(less("Trash").textContent).toBe("−");
    await act(async () => more("Trash").click());
    expect(said(points)).toBe("21 pts");
    expect(row(el, "Trash").dataset.changed).toBe("true");
    await act(async () => less("Trash").click());
    await act(async () => less("Trash").click());
    expect(said(points)).toBe("19 pts");
    // Points only: effort and cooldown have no − or +.
    expect(row(el, "Trash").querySelectorAll("button")).toHaveLength(2);
    // At the top, + is off.
    await press(points, "End");
    expect(said(points)).toBe(`${BASE_POINTS_MAX} pts`);
    expect(more("Trash").disabled).toBe(true);
    expect(less("Trash").disabled).toBe(false);
    // From Not set, either gives the least; at the bottom, − is off.
    expect(more("Shelf").disabled).toBe(false);
    expect(less("Shelf").disabled).toBe(false);
    await act(async () => less("Shelf").click());
    const shelf = control<HTMLInputElement>(el, "Shelf", "Points");
    expect(said(shelf)).toBe("1 pt");
    expect(less("Shelf").disabled).toBe(true);
    await act(async () => more("Shelf").click());
    expect(said(shelf)).toBe("2 pts");
    await slideTo(
      control<HTMLInputElement>(el, "Shelf", "Cooldown (h)"),
      "0 h",
    );
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(sentChanges(action)).toEqual([
      { choreId: BOUNTIES[0]!.id, points: BASE_POINTS_MAX },
      { choreId: SHELF.id, points: 2, cooldownHours: 0 },
    ]);
  });

  it("unmarks the row when + then − bring the points back to the bounty's own", async () => {
    const action = vi.fn(async (_p: Result | null, _f: FormData) => OK);
    const { el } = await mountWith(action);
    const button = (name: string) =>
      el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    await act(async () => button("One point more for Trash").click());
    expect(row(el, "Trash").dataset.changed).toBe("true");
    await act(async () => button("One point less for Trash").click());
    expect(said(control<HTMLInputElement>(el, "Trash", "Points"))).toBe(
      "20 pts",
    );
    expect(row(el, "Trash").dataset.changed).toBeUndefined();
    expect(el.textContent).toContain("No changes yet.");
  });

  it("hands the focus to the slider when − or + turns itself off at a limit", async () => {
    const { el } = await mountWith(
      vi.fn(async () => OK),
      {},
      [
        { ...BOUNTIES[0]!, basePoints: 2 },
        { ...BOUNTIES[1]!, basePoints: BASE_POINTS_MAX - 1 },
      ],
    );
    const button = (name: string) =>
      el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    // One step from the limit: the button keeps the focus.
    const less = button("One point less for Trash");
    less.focus();
    await act(async () => less.click());
    expect(said(control<HTMLInputElement>(el, "Trash", "Points"))).toBe("1 pt");
    expect(less.disabled).toBe(true);
    expect(document.activeElement).toBe(
      control<HTMLInputElement>(el, "Trash", "Points"),
    );
    const more = button("One point more for Dishes");
    more.focus();
    await act(async () => more.click());
    expect(more.disabled).toBe(true);
    expect(document.activeElement).toBe(
      control<HTMLInputElement>(el, "Dishes", "Points"),
    );
    // Short of a limit the focus stays on the button.
    const again = button("One point more for Trash");
    again.focus();
    await act(async () => again.click());
    expect(document.activeElement).toBe(again);
  });

  it("on the kitchen screen, − and + are touch-sized", async () => {
    const { el } = await mount(OK, { pinLabel: "Ryan's PIN" });
    for (const name of [
      "One point less for Trash",
      "One point more for Trash",
    ]) {
      expect(
        el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
          .className,
      ).toContain("min-h-14");
    }
  });

  it("forgets a slider moved back to the bounty's own value, so a refresh shows another admin's edit", async () => {
    const action = vi.fn(async (_p: Result | null, _f: FormData) => OK);
    const { el, rerender } = await mountWith(action, {}, [SHELF]);
    const effort = control<HTMLInputElement>(el, "Shelf", "Effort (%)");
    await press(effort, "ArrowRight");
    await press(effort, "ArrowLeft");
    expect(said(effort)).toBe("123%");
    // Another admin sets the effort to 100%; the page refreshes.
    await rerender([{ ...SHELF, effortFactorPct: 100 }]);
    expect(said(effort)).toBe("100%");
    // The thumb stands where the text says.
    expect(effort.value).toBe(String(EFFORT_STOPS.indexOf(100)));
    expect(row(el, "Shelf").dataset.changed).toBeUndefined();
  });

  it("names each slider for its bounty", async () => {
    const { el } = await mount(OK);
    expect(
      control<HTMLInputElement>(el, "Dishes", "Effort (%)").getAttribute(
        "aria-label",
      ),
    ).toBe("Effort (%) for Dishes");
  });

  it("can put back a value that is off the slider's scale", async () => {
    const action = vi.fn(async (_p: Result | null, _f: FormData) => OK);
    const { el } = await mountWith(action, {}, [SHELF]);
    const effort = control<HTMLInputElement>(el, "Shelf", "Effort (%)");
    expect(said(effort)).toBe("123%");
    await press(effort, "ArrowRight");
    expect(said(effort)).toBe("125%");
    expect(row(el, "Shelf").dataset.changed).toBe("true");
    await press(effort, "ArrowLeft");
    expect(said(effort)).toBe("123%");
    expect(row(el, "Shelf").dataset.changed).toBeUndefined();
  });

  it("says Not set for a bounty with no points, Required for the other half once one is set, and Clear undoes it", async () => {
    const action = vi.fn(async (_p: Result | null, _f: FormData) => OK);
    const { el } = await mountWith(action, {}, [SHELF]);
    const points = control<HTMLInputElement>(el, "Shelf", "Points");
    const cooldown = control<HTMLInputElement>(el, "Shelf", "Cooldown (h)");
    expect(said(points)).toBe("Not set");
    expect(said(cooldown)).toBe("Not set");
    expect(row(el, "Shelf").textContent).not.toContain("Required.");
    expect(button(el, /^Clear$/)).toBeUndefined();

    await slideTo(points, "26 pts");
    expect(row(el, "Shelf").textContent).toContain("Required.");
    expect(cooldown.getAttribute("aria-invalid")).toBe("true");
    expect(button(el, "Save 1 change").disabled).toBe(true);
    expect(el.textContent).toContain("Fill in the fields marked Required.");
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(action).not.toHaveBeenCalled();

    // Clear puts the points back to not set, and nothing is left to save.
    const clear = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear Points for Shelf"]',
    )!;
    expect(clear.textContent).toBe("Clear");
    await act(async () => clear.click());
    expect(said(points)).toBe("Not set");
    expect(row(el, "Shelf").textContent).not.toContain("Required.");
    expect(row(el, "Shelf").dataset.changed).toBeUndefined();
    expect(el.textContent).toContain("No changes yet.");

    // Both halves set: it saves.
    await slideTo(points, "26 pts");
    await slideTo(cooldown, "0 h");
    expect(row(el, "Shelf").textContent).not.toContain("Required.");
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(sentChanges(action)).toEqual([
      { choreId: SHELF.id, points: 26, cooldownHours: 0 },
    ]);
  });

  it("never sends back a field the admin did not touch", async () => {
    const action = vi.fn(async (_p: Result | null, _f: FormData) => OK);
    const { el, rerender } = await mountWith(action);
    await slideTo(control<HTMLInputElement>(el, "Trash", "Points"), "7 pts");
    // Another admin makes Trash a consumable; the page refreshes.
    await rerender([
      { ...BOUNTIES[0]!, kind: "consumable" },
      ...BOUNTIES.slice(1),
    ]);
    expect(control<HTMLSelectElement>(el, "Trash", "Kind").value).toBe(
      "consumable",
    );
    expect(said(control<HTMLInputElement>(el, "Trash", "Points"))).toBe(
      "7 pts",
    );
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(sentChanges(action)).toEqual([
      { choreId: BOUNTIES[0]!.id, points: 7 },
    ]);
  });

  it("shows a clash on its row, and says it above Save too", async () => {
    const message = "There is already a chore called Trash. Pick another name.";
    const { el } = await mount({
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message,
      issues: [{ path: ["changes", 0, "name"], message }],
    });
    await set(control<HTMLInputElement>(el, "Dishes", "Name"), "Trash");
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(row(el, "Dishes").textContent).toContain(message);
    expect(row(el, "Trash").textContent).not.toContain(message);
    expect(el.querySelector('[role="alert"]')!.textContent).toBe(message);
  });

  it("names the bounty in each control's description", async () => {
    const { el } = await mount(OK);
    const points = control<HTMLInputElement>(el, "Dishes", "Points");
    const ids = points.getAttribute("aria-describedby")!.split(" ");
    const described = ids
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
    expect(described).toContain("Dishes");
    expect(described).not.toContain("Trash");
  });

  it("on the kitchen screen, sends the same changes again with the PIN, from a bar that stays in view", async () => {
    const action = vi
      .fn<(p: Result | null, f: FormData) => Promise<Result>>()
      .mockResolvedValueOnce({
        ok: false,
        code: "ATTESTATION_REQUIRED",
        message: "Enter your PIN to do this.",
      })
      .mockResolvedValueOnce(OK);
    const { el } = await mountWith(action, { pinLabel: "Ryan's PIN" });
    const bar = el.querySelector<HTMLElement>('[data-testid="bulk-save-bar"]')!;
    expect(bar.className).toContain("sticky");
    expect(bar.textContent).toContain("Discard");
    await editTwo(el);
    await act(async () => button(bar, "Save 3 changes").click());
    const pad = el.querySelector<HTMLElement>(
      '[role="group"][aria-label="Ryan\'s PIN"]',
    )!;
    for (const digit of "2580") {
      await act(async () => button(pad, digit).click());
    }
    await act(async () => button(pad, "OK").click());
    expect(action).toHaveBeenCalledTimes(2);
    const [first, second] = action.mock.calls.map(
      ([, form]) => form as FormData,
    );
    expect(second!.get(CHANGES_FIELD)).toBe(first!.get(CHANGES_FIELD));
    expect(JSON.parse(second!.get(CHANGES_FIELD) as string)).toHaveLength(3);
    expect(first!.get("pin")).toBeNull();
    expect(second!.get("pin")).toBe("2580");
    expect(toastSuccess).toHaveBeenCalledWith("Saved 3 bounties.");
  });

  it("clears a failed save's notes as soon as a field is edited again", async () => {
    const message = "There is already a chore called Trash. Pick another name.";
    const { el } = await mount({
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message,
      issues: [{ path: ["changes", 0, "name"], message }],
    });
    await set(control<HTMLInputElement>(el, "Dishes", "Name"), "Trash");
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(row(el, "Dishes").textContent).toContain(message);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    await set(control<HTMLInputElement>(el, "Dishes", "Name"), "Dishes");
    expect(row(el, "Dishes").textContent).not.toContain(message);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).toContain("No changes yet.");
  });

  it("on the kitchen screen, says what is wrong in the bar by Save", async () => {
    const message = "There is already a chore called Trash. Pick another name.";
    const { el } = await mountWith(
      async () => ({ ok: false, code: "CHORE_NAME_TAKEN", message }),
      { pinLabel: "Ryan's PIN" },
      [...BOUNTIES, SHELF],
    );
    const bar = () =>
      el.querySelector<HTMLElement>('[data-testid="bulk-save-bar"]')!;
    expect(bar().textContent).toContain("No changes yet.");
    await press(control<HTMLInputElement>(el, "Shelf", "Points"), "End");
    expect(bar().textContent).toContain("Fill in the fields marked Required.");
    // Clear is a kiosk-sized button.
    const clear = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear Points for Shelf"]',
    )!;
    expect(clear.className).toContain("min-h-14");
    await act(async () => clear.click());
    await set(control<HTMLInputElement>(el, "Dishes", "Name"), "Trash");
    expect(bar().textContent).toContain("1 bounty changed, not saved yet.");
    await act(async () => button(bar(), "Save 1 change").click());
    expect(bar().querySelector('[role="alert"]')!.textContent).toBe(message);
  });

  it("fills every row of the grid, at every width", async () => {
    for (const opts of [{}, { pinLabel: "Ryan's PIN" }]) {
      const { el } = await mount(OK, opts);
      const grid = row(el, "Trash").querySelector<HTMLElement>(
        ":scope > .grid",
      )!;
      const cells = [...grid.children];
      expect(cells.length).toBe(7);
      for (const bp of ["", "sm:", "lg:"]) {
        const cols = widest(grid, "grid-cols-", bp);
        const used = cells.reduce((n, c) => n + widest(c, "col-span-", bp), 0);
        expect(
          used % cols,
          `${"pinLabel" in opts ? "kiosk" : "hub"} ${bp || "base"} in ${cols} columns`,
        ).toBe(0);
        // The points (with − and +) and the cooldown (with "720 h · 30
        // days" beside its track) get a whole row each, so the points' +
        // never sits by the cooldown.
        for (const label of ["Points", "Cooldown (h)"]) {
          const cell = cells.find((c) =>
            [...c.querySelectorAll("label")].some(
              (l) => l.textContent === label,
            ),
          )!;
          expect(
            widest(cell, "col-span-", bp),
            `${label} at ${bp || "base"}`,
          ).toBe(cols);
        }
      }
      await act(async () => root?.unmount());
      root = null;
      document.body.innerHTML = "";
    }
  });
});

/**
 * The value of a Tailwind `prefix-N` class in effect at a breakpoint: the
 * breakpoint's own, else a smaller one's, else 1.
 */
function widest(el: Element, prefix: string, bp: string): number {
  const order = ["", "sm:", "lg:"];
  const classes = [...el.classList];
  for (const b of order.slice(0, order.indexOf(bp) + 1).reverse()) {
    const hit = classes.find(
      (c) =>
        c.startsWith(b + prefix) &&
        /\d+$/.test(c) &&
        c.slice(b.length).startsWith(prefix),
    );
    if (hit) return Number(hit.slice((b + prefix).length));
  }
  return 1;
}
