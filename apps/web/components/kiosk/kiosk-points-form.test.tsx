import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import type { WeightDecisionData } from "@/lib/actions/weights";
import { KioskPointsForm, type PointsBounty } from "./kiosk-points-form";

// The kitchen screen's "Change a bounty's points" (issues #147, #177): the
// first send has no PIN, React resets the form once it answers, and the
// PIN's second send must still carry the bounty and the numbers that were
// picked, not the list's first option.

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

const BOUNTIES: PointsBounty[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Bathroom",
    basePoints: 20,
    cooldownMinutes: 24 * 60,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Fridge",
    basePoints: 10,
    cooldownMinutes: 12 * 60,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Gutters",
    basePoints: 30,
    cooldownMinutes: 48 * 60,
  },
];

type Result = ActionResult<WeightDecisionData>;

const NEEDS_PIN: Result = {
  ok: false,
  code: "ATTESTATION_REQUIRED",
  message: "Enter your PIN to do this.",
};

const scheduled = (choreId: string): Result => ({
  ok: true,
  data: {
    suggestionId: "44444444-4444-4444-8444-444444444444",
    choreId,
    status: "scheduled",
    appliesAt: "2026-10-12T22:00:00.000Z",
    basePoints: 42,
    cooldownMinutes: 6 * 60,
  },
});

async function mount(
  action: (p: Result | null, f: FormData) => Promise<Result>,
) {
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root!.render(
      <KioskPointsForm
        bounties={BOUNTIES}
        pinLabel="Ryan's PIN"
        action={action}
      />,
    ),
  );
  return el;
}

const control = <T extends HTMLElement>(el: HTMLElement, label: string) => {
  const lab = [...el.querySelectorAll("label")].find(
    (l) => l.textContent === label,
  )!;
  return el.querySelector<T>(`#${CSS.escape(lab.htmlFor)}`)!;
};

/** Set a controlled field's value as a user would. */
async function set(
  target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    target instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : target instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
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

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === text)!;

const sent = (form: FormData) => ({
  choreId: form.get("choreId"),
  basePoints: form.get("basePoints"),
  cooldownHours: form.get("cooldownHours"),
  reason: form.get("reason"),
});

describe("KioskPointsForm", () => {
  it("sends the picked bounty and its numbers again with the PIN (#177)", async () => {
    const fridge = BOUNTIES[1]!;
    const action = vi
      .fn<(p: Result | null, f: FormData) => Promise<Result>>()
      .mockResolvedValueOnce(NEEDS_PIN)
      .mockResolvedValueOnce(scheduled(fridge.id));
    const el = await mount(action);
    await set(control<HTMLSelectElement>(el, "Bounty"), fridge.id);
    await set(control<HTMLInputElement>(el, "Points"), "42");
    await set(control<HTMLInputElement>(el, "Cooldown (hours)"), "6");
    await set(
      control<HTMLTextAreaElement>(el, "Reason (optional)"),
      "Takes ages",
    );
    await act(async () => button(el, "Schedule change").click());
    const pad = el.querySelector<HTMLElement>(
      '[role="group"][aria-label="Ryan\'s PIN"]',
    )!;
    expect(pad).not.toBeNull();
    // What the admin sees is still what they picked.
    expect(control<HTMLSelectElement>(el, "Bounty").value).toBe(fridge.id);
    for (const digit of "2580") {
      await act(async () => button(pad, digit).click());
    }
    await act(async () => button(pad, "OK").click());
    expect(action).toHaveBeenCalledTimes(2);
    const [first, second] = action.mock.calls.map(
      ([, form]) => form as FormData,
    );
    const picked = {
      choreId: fridge.id,
      basePoints: "42",
      cooldownHours: "6",
      reason: "Takes ages",
    };
    expect(sent(first!)).toEqual(picked);
    expect(sent(second!)).toEqual(picked);
    expect(first!.get("pin")).toBeNull();
    expect(second!.get("pin")).toBe("2580");
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0]![0]).toMatch(/^Fridge: /);
  });

  it("names the bounty the server changed, not the one on screen", async () => {
    const gutters = BOUNTIES[2]!;
    const el = await mount(async () => scheduled(gutters.id));
    await set(control<HTMLSelectElement>(el, "Bounty"), BOUNTIES[1]!.id);
    await act(async () => button(el, "Schedule change").click());
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0]![0]).toMatch(/^Gutters: /);
  });

  it("shows an input issue under its field, and clears it when edited", async () => {
    const message = "Points must be at most 100.";
    const el = await mount(async () => ({
      ok: false,
      code: "INVALID_INPUT",
      message: "Some of that did not look right.",
      issues: [
        { path: ["basePoints"], message },
        { path: ["cooldownHours"], message: "Too long." },
      ],
    }));
    const points = control<HTMLInputElement>(el, "Points");
    await set(points, "1000");
    await act(async () => button(el, "Schedule change").click());
    const note = el.querySelector(`#${CSS.escape(points.id)}-error`);
    expect(note?.textContent).toBe(message);
    expect(points.getAttribute("aria-invalid")).toBe("true");
    const cooldown = control<HTMLInputElement>(el, "Cooldown (hours)");
    expect(cooldown.getAttribute("aria-invalid")).toBe("true");
    // Editing Points clears its note, and only its note.
    await set(points, "42");
    expect(el.textContent).toContain("Too long.");
    expect(el.textContent).not.toContain(message);
    expect(points.getAttribute("aria-invalid")).toBeNull();
  });

  it("fills the numbers from the picked bounty", async () => {
    const el = await mount(async () => NEEDS_PIN);
    expect(control<HTMLInputElement>(el, "Points").value).toBe("20");
    await set(control<HTMLSelectElement>(el, "Bounty"), BOUNTIES[2]!.id);
    expect(control<HTMLInputElement>(el, "Points").value).toBe("30");
    expect(control<HTMLInputElement>(el, "Cooldown (hours)").value).toBe("48");
  });
});
