import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FormAction } from "@/components/use-action-form";
import type { DeleteEventData } from "@/lib/actions/calendar";
import type { DeleteNoteData, NoteView } from "@/lib/actions/notes";
import type { ActionResult } from "@/lib/actions/result";
import type { CalendarEventView } from "@/lib/calendar/view";

// Issue #174: a sheet whose form is sending stays open (its ×, Cancel or
// Keep it disabled, a tap outside ignored) until the answer is in, so the
// form is still there to show it. The note board and the kitchen
// calendar, each with its add or edit sheet and its delete sheet.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { NoteBoard } = await import("./notes/note-board");
const { CalendarManager } = await import("./kiosk/calendar-manager");

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
});

/** An action whose answer waits for `answer()`. */
function held<T>() {
  let answer!: (r: ActionResult<T>) => void;
  const action = vi.fn(
    () =>
      new Promise<ActionResult<T>>((r) => {
        answer = r;
      }),
  ) as unknown as FormAction<T> & ReturnType<typeof vi.fn>;
  return { action, answer: (r: ActionResult<T>) => answer(r) };
}

async function render(node: React.ReactNode) {
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(node));
  return el;
}

const byText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
const corner = (sheet: HTMLDialogElement) =>
  sheet.querySelector<HTMLButtonElement>(
    ':scope > div > button[aria-label="Close"]',
  )!;
async function tapOutside(sheet: HTMLDialogElement) {
  await act(async () => {
    sheet.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    sheet.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
const sheetNamed = (name: string) =>
  document.querySelector<HTMLDialogElement>(`dialog[aria-label="${name}"]`)!;

/** Sending: every way out is held, and the sheet is still there. */
async function expectHeld(sheet: HTMLDialogElement, keep: string) {
  expect(sheet.open).toBe(true);
  expect(corner(sheet).disabled).toBe(true);
  expect(byText(sheet, keep)!.disabled).toBe(true);
  await tapOutside(sheet);
  const escape = new Event("cancel", { cancelable: true });
  await act(async () => sheet.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(sheet.open).toBe(true);
}

const note: NoteView = {
  id: "n-1",
  title: "Plumber",
  bodyMd: "Tuesday",
  color: null,
  pinned: false,
  authorId: "m-1",
  authorName: "Ryan",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  editedAt: "2026-10-01T10:00:00.000Z",
  seenBy: ["m-1"],
} as NoteView;

describe("NoteBoard's sheets", () => {
  function board(over: Partial<Record<string, unknown>> = {}) {
    const none = vi.fn(async () => ({ ok: true, data: null }));
    return {
      create: none,
      update: none,
      pin: none,
      remove: none,
      ...over,
    } as never;
  }

  it("keeps the new note open while it saves", async () => {
    const save = held<{ note: NoteView }>();
    await render(
      <NoteBoard
        notes={[]}
        canEdit
        pinLabel="Ryan's PIN"
        actions={board({ create: save.action })}
      />,
    );
    await act(async () => byText(document, "New note")!.click());
    const sheet = sheetNamed("New note");
    expect(sheet.open).toBe(true);
    const title = sheet.querySelector<HTMLInputElement>("#note-new-title")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      set.call(title, "Bins");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    expect(save.action).toHaveBeenCalledTimes(1);
    await expectHeld(sheet, "Cancel");
    await act(async () => save.answer({ ok: true, data: { note } }));
    expect(sheet.open).toBe(false);
  });

  it("keeps the delete sheet open while it deletes", async () => {
    const remove = held<DeleteNoteData>();
    await render(
      <NoteBoard
        notes={[note]}
        canEdit
        pinLabel="Ryan's PIN"
        actions={board({ remove: remove.action })}
      />,
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Delete Plumber"]',
        )!
        .click(),
    );
    const sheet = sheetNamed("Delete Plumber?");
    expect(sheet.open).toBe(true);
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    expect(remove.action).toHaveBeenCalledTimes(1);
    await expectHeld(sheet, "Keep it");
    await act(async () =>
      remove.answer({ ok: true, data: { noteId: "n-1", title: "Plumber" } }),
    );
    expect(sheet.open).toBe(false);
  });
});

const dinner: CalendarEventView = {
  id: "e-1",
  title: "Dinner",
  description: null,
  location: null,
  allDay: false,
  start: "2026-10-06T17:00:00.000Z",
  end: "2026-10-06T18:00:00.000Z",
  startDate: "2026-10-06",
  endDate: "2026-10-06",
  startTime: "19:00",
  endTime: "20:00",
  when: "Tue 6 Oct, 19:00–20:00",
  addedBy: null,
  forMember: null,
};

describe("CalendarManager's sheets", () => {
  async function manager(over: Partial<Record<string, unknown>>) {
    const none = vi.fn(async () => ({ ok: true, data: null }));
    await render(
      <CalendarManager
        groups={[
          { key: "today", title: "Today", empty: "Nothing.", events: [dinner] },
        ]}
        today="2026-10-06"
        people={[]}
        canEdit
        pinLabel="Ryan's PIN"
        actions={{ create: none, update: none, remove: none, ...over } as never}
      />,
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="upcoming-event-e-1"] button',
        )!
        .click(),
    );
    const edit = sheetNamed("Edit Dinner");
    expect(edit.open).toBe(true);
    return edit;
  }

  it("keeps the edit sheet open while it saves", async () => {
    const save = held<{ event: CalendarEventView }>();
    const edit = await manager({ update: save.action });
    await act(async () => edit.querySelector("form")!.requestSubmit());
    expect(save.action).toHaveBeenCalledTimes(1);
    await expectHeld(edit, "Cancel");
    expect(byText(edit, "Delete…")!.disabled).toBe(true);
    await act(async () => save.answer({ ok: true, data: { event: dinner } }));
    expect(edit.open).toBe(false);
  });

  it("keeps the delete sheet open while it deletes", async () => {
    const remove = held<DeleteEventData>();
    const edit = await manager({ remove: remove.action });
    await act(async () => byText(edit, "Delete…")!.click());
    const sheet = sheetNamed("Delete Dinner?");
    expect(sheet.open).toBe(true);
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    expect(remove.action).toHaveBeenCalledTimes(1);
    await expectHeld(sheet, "Keep it");
    await act(async () =>
      remove.answer({ ok: true, data: { eventId: "e-1", title: "Dinner" } }),
    );
    expect(sheet.open).toBe(false);
  });
});
