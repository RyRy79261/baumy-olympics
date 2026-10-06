import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { ActionResult } from "@/lib/actions/result";
import { dismissToast, getToasts } from "@/lib/ui/toast";

// A bounty's "Log …" sheet (issue #174): Cancel, its × and a tap outside put
// it down, but not while "Log it" is on its way, so the answer (the toast,
// the score) always shows.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { ChoreGrid } = await import("./chore-grid");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has <dialog> without the modal methods: these act as a browser.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  dismissToast();
});

const chore: ChoreView = {
  id: "c-1",
  name: "Trash",
  sprite: "trash",
  kind: "maintenance",
  proofMode: "none",
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

const LOGGED: ActionResult<LogCompletionData> = {
  ok: true,
  data: {
    completionId: "x-1",
    choreId: chore.id,
    choreName: chore.name,
    doneBy: "m-1",
    doneByName: "Ryan",
    loggedBy: "m-1",
    status: "pending",
    occurredAt: "2026-10-06T10:00:00.000Z",
    hasPhoto: false,
    totalPts: 40,
    streakLen: 1,
    breakPts: null,
    brokenMemberId: null,
    brokenMemberName: null,
    brokenLen: null,
  },
};

async function openSheet(
  opts: {
    members?: { id: string; displayName: string }[];
    chore?: ChoreView;
  } = {},
) {
  let answer!: (r: ActionResult<LogCompletionData>) => void;
  const action = vi.fn(
    () =>
      new Promise<ActionResult<LogCompletionData>>((r) => {
        answer = r;
      }),
  );
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root!.render(
      <ChoreGrid
        chores={[opts.chore ?? chore]}
        members={opts.members ?? [{ id: "m-1", displayName: "Ryan" }]}
        actorId="m-1"
        kiosk
        action={action}
        initialOpenId={chore.id}
      />,
    ),
  );
  const sheet = el.querySelector<HTMLDialogElement>(
    'dialog[aria-label="Log Trash"]',
  )!;
  expect(sheet.open).toBe(true);
  // The sheet's own ×, not the one of the PIN dialog inside its form.
  const button = (name: string) =>
    name === "Close"
      ? sheet.querySelector<HTMLButtonElement>(
          ':scope > div > button[aria-label="Close"]',
        )!
      : [...sheet.querySelectorAll("button")].find(
          (b) => b.textContent === name,
        )!;
  return { sheet, button, action, answer: (r = LOGGED) => answer(r) };
}

async function tapOutside(sheet: HTMLDialogElement) {
  await act(async () => {
    sheet.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    sheet.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ChoreGrid's log sheet", () => {
  it("closes from Cancel, logging nothing", async () => {
    const { sheet, button, action } = await openSheet();
    expect(button("Cancel")).toBeDefined();
    await act(async () => button("Cancel").click());
    expect(sheet.open).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("stays open while Log it is sending, then closes with the toast", async () => {
    const { sheet, button, action, answer } = await openSheet();
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    expect(action).toHaveBeenCalledTimes(1);
    expect(button("Cancel").disabled).toBe(true);
    expect(button("Close").disabled).toBe(true);
    await tapOutside(sheet);
    const escape = new Event("cancel", { cancelable: true });
    await act(async () => sheet.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(sheet.open).toBe(true);

    await act(async () => answer());
    expect(sheet.open).toBe(false);
    expect(getToasts().map((t) => t.title)).toContain(
      "Logged Trash for Ryan: +40.",
    );
  });

  it("can be put down again once the answer is in", async () => {
    const { sheet, button, answer } = await openSheet();
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    expect(button("Close").disabled).toBe(true);
    await act(async () =>
      answer({ ok: false, code: "COOLDOWN", message: "Not yet." }),
    );
    // The sheet closed with the answer; open it again from its row.
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="chore-Trash"] button')!
        .click(),
    );
    expect(sheet.open).toBe(true);
    expect(button("Close").disabled).toBe(false);
    await tapOutside(sheet);
    expect(sheet.open).toBe(false);
  });

  it("locks who did it and the photo while Log it is sending", async () => {
    const { sheet, answer } = await openSheet({
      members: [
        { id: "m-1", displayName: "Ryan" },
        { id: "m-2", displayName: "Felix" },
      ],
      chore: { ...chore, proofMode: "optional" },
    });
    const radios = () => [
      ...sheet.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];
    const photo = () =>
      sheet.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(radios()).toHaveLength(2);
    expect(photo()).not.toBeNull();
    expect(radios().some((r) => r.disabled)).toBe(false);
    expect(photo().disabled).toBe(false);
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    try {
      // The form is keyed by who did it: a new pick now would remount it,
      // lose the answer and allow a second log.
      expect(radios().every((r) => r.disabled)).toBe(true);
      expect(photo().disabled).toBe(true);
    } finally {
      await act(async () => answer());
    }
  });
});
