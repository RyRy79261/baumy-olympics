import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_POINTS_MAX } from "@baumy/types";
import type { ActionResult } from "@/lib/actions/result";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";
import { CHANGES_FIELD } from "@/lib/chores/bulk-edit";
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

async function editTwo(el: HTMLElement) {
  await set(
    control<HTMLInputElement>(el, "Trash", "Points"),
    String(BASE_POINTS_MAX),
  );
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
    expect(control<HTMLInputElement>(el, "Trash", "Points").value).toBe("20");
    expect(control<HTMLInputElement>(el, "Trash", "Cooldown (h)").value).toBe(
      "24",
    );
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
    await set(control<HTMLInputElement>(el, "Trash", "Points"), "7");
    await act(async () => button(el, "Save 1 change").click());
    // React resets a form after its action answers; the rows are not part
    // of it, so what they show is still what will be sent.
    expect(control<HTMLSelectElement>(el, "Trash", "Kind").value).toBe(
      "consumable",
    );
    expect(control<HTMLInputElement>(el, "Trash", "Points").value).toBe("7");
  });
});
