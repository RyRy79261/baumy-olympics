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
import { defaultAvatar } from "@baumy/types";
import type { ListRemindersData, ReminderView } from "@/lib/actions/reminders";
import { REMINDER_POLL_MS } from "@/lib/kiosk/constants";
import { NIGHT_EVENT } from "@/lib/kiosk/night";

// The kitchen screen's reminder overlay (ADR 0005 §4, issue #66): it shows
// the oldest reminder, each face's tap acknowledges as that face, the last
// one lingers for its tick and then goes, "Dismiss for everyone" asks who,
// a poll brings a reminder posted elsewhere (only away from home and while
// awake), and a reminder coming up closes any open dialog.

const seenAction = vi.fn();
const dismissAction = vi.fn();
const listAction = vi.fn();
vi.mock("@/app/kiosk/reminder-actions", () => ({
  kioskSeenReminderAction: (f: FormData) => seenAction(f),
  kioskDismissReminderAction: (f: FormData) => dismissAction(f),
  kioskRemindersAction: () => listAction(),
}));

// Which kiosk page is open: the home page refreshes itself.
let pathname = "/kiosk/chores";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { KioskReminders, SEEN_LINGER_MS } = await import("./reminders");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let div: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  seenAction.mockReset();
  dismissAction.mockReset();
  listAction.mockReset();
  pathname = "/kiosk/chores";
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  div?.remove();
  vi.useRealTimers();
});

const member = (id: string, displayName: string) => ({
  id,
  displayName,
  color: "#4ff5e6",
  avatar: defaultAvatar(id),
});
const R1: ReminderView = {
  id: "r1",
  title: "Handyman on Wednesday",
  body: "Someone must be home.",
  createdBy: { id: "a", name: "Ana" },
  createdAt: "2026-09-27T10:00:00.000Z",
  seenBy: [],
  waitingFor: ["a", "b"],
};
const R2: ReminderView = { ...R1, id: "r2", title: "Water off Friday" };
const DATA: ListRemindersData = {
  members: [member("a", "Ana"), member("b", "Ben")],
  reminders: [R1, R2],
};

function mount(initial: ListRemindersData | null) {
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  act(() => root!.render(<KioskReminders initial={initial} />));
}

const title = () => div.querySelector("#reminder-title")?.textContent ?? null;
const button = (name: string) =>
  [...div.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent) === name,
  )!;
async function tap(name: string) {
  await act(async () => {
    button(name).click();
  });
}

describe("KioskReminders", () => {
  it("shows nothing without a reminder", () => {
    mount({ ...DATA, reminders: [] });
    expect(div.innerHTML).toBe("");
    act(() => root!.unmount());
    root = null;
    mount(null);
    expect(div.innerHTML).toBe("");
  });

  it("acknowledges as each face, then shows the last tick and moves on", async () => {
    mount(DATA);
    expect(title()).toBe("Handyman on Wednesday");
    expect(div.textContent).toContain("0 of 2 have seen it");

    seenAction.mockResolvedValueOnce({
      ok: true,
      data: { reminderId: "r1", memberId: "b", seenByEveryone: false },
    });
    await tap("I've seen it, Ben");
    const sent = seenAction.mock.calls[0]![0] as FormData;
    expect(sent.get("memberId")).toBe("b");
    expect(sent.get("reminderId")).toBe("r1");
    expect(sent.get("requestId")).toBeTruthy();
    expect(div.textContent).toContain("1 of 2 have seen it");
    expect(button("Ben has seen it").disabled).toBe(true);

    seenAction.mockResolvedValueOnce({
      ok: true,
      data: { reminderId: "r1", memberId: "a", seenByEveryone: true },
    });
    await tap("I've seen it, Ana");
    // Everyone has: the full count shows for a moment...
    expect(title()).toBe("Handyman on Wednesday");
    expect(div.textContent).toContain("2 of 2 have seen it");
    act(() => {
      vi.advanceTimersByTime(SEEN_LINGER_MS);
    });
    // ...then the next reminder.
    expect(title()).toBe("Water off Friday");
    expect(div.textContent).toContain("0 of 2 have seen it");
  });

  it("says why a tap did not take, and asks again", async () => {
    mount(DATA);
    seenAction.mockResolvedValueOnce({
      ok: false,
      code: "NOT_FOUND",
      message: "That reminder is not there any more.",
    });
    listAction.mockResolvedValueOnce({
      ok: true,
      data: { ...DATA, reminders: [R2] },
    });
    await tap("I've seen it, Ana");
    expect(div.querySelector('[role="alert"]')?.textContent).toBe(
      "That reminder is not there any more.",
    );
    expect(listAction).toHaveBeenCalledOnce();
    expect(title()).toBe("Water off Friday");

    // A tap that never arrives (offline) says so too.
    seenAction.mockRejectedValueOnce(new Error("offline"));
    listAction.mockRejectedValueOnce(new Error("offline"));
    await tap("I've seen it, Ana");
    expect(div.querySelector('[role="alert"]')?.textContent).toBe(
      "That did not go through. Try again.",
    );
  });

  it("dismisses for everyone as whoever says so", async () => {
    mount(DATA);
    await tap("Dismiss for everyone");
    expect(div.textContent).toContain("Who is dismissing it for everyone?");
    await tap("Cancel");
    expect(div.textContent).not.toContain("Who is dismissing it");

    await tap("Dismiss for everyone");
    dismissAction.mockResolvedValueOnce({
      ok: true,
      data: { reminderId: "r1", title: R1.title },
    });
    const chooser = div.querySelector('[data-testid="reminder-dismissers"]')!;
    await act(async () => {
      [...chooser.querySelectorAll("button")]
        .find((b) => b.textContent === "Ana")!
        .click();
    });
    const sent = dismissAction.mock.calls[0]![0] as FormData;
    expect(sent.get("memberId")).toBe("a");
    expect(sent.get("reminderId")).toBe("r1");
    expect(title()).toBe("Water off Friday");

    dismissAction.mockResolvedValueOnce({
      ok: false,
      code: "NOT_FOUND",
      message: "That reminder has already been dismissed.",
    });
    listAction.mockResolvedValueOnce({ ok: true, data: DATA });
    await tap("Dismiss for everyone");
    await act(async () => {
      [
        ...div
          .querySelector('[data-testid="reminder-dismissers"]')!
          .querySelectorAll("button"),
      ]
        .find((b) => b.textContent === "Ben")!
        .click();
    });
    expect(div.querySelector('[role="alert"]')?.textContent).toBe(
      "That reminder has already been dismissed.",
    );
  });

  it("closes an open dialog (a PIN pad) when a reminder comes up", () => {
    const dialog = document.createElement("dialog");
    dialog.close = vi.fn(() => dialog.removeAttribute("open"));
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    mount({ ...DATA, reminders: [] });
    expect(dialog.close).not.toHaveBeenCalled();
    act(() => root!.render(<KioskReminders initial={DATA} />));
    expect(title()).toBe("Handyman on Wednesday");
    expect(dialog.close).toHaveBeenCalledOnce();
    dialog.remove();
  });

  it("polls only away from home and while awake, and at once on waking", async () => {
    const night = (asleep: boolean) =>
      act(async () => {
        window.dispatchEvent(
          new CustomEvent(NIGHT_EVENT, { detail: { asleep } }),
        );
      });
    listAction.mockResolvedValue({
      ok: true,
      data: { ...DATA, reminders: [] },
    });
    // Away from home: every minute.
    mount({ ...DATA, reminders: [] });
    await act(async () => {
      vi.advanceTimersByTime(REMINDER_POLL_MS);
    });
    expect(listAction).toHaveBeenCalledTimes(1);
    // Asleep: nothing; waking asks at once.
    await night(true);
    await act(async () => {
      vi.advanceTimersByTime(3 * REMINDER_POLL_MS);
    });
    expect(listAction).toHaveBeenCalledTimes(1);
    await night(false);
    expect(listAction).toHaveBeenCalledTimes(2);
    act(() => root!.unmount());
    root = null;
    div.remove();

    // On the home page its own refresh brings them: no reads of our own.
    pathname = "/kiosk";
    listAction.mockClear();
    mount({ ...DATA, reminders: [] });
    await act(async () => {
      vi.advanceTimersByTime(3 * REMINDER_POLL_MS);
    });
    expect(listAction).not.toHaveBeenCalled();
  });

  it("brings a reminder posted elsewhere on the next poll, and takes the shell's", async () => {
    mount({ ...DATA, reminders: [] });
    listAction.mockResolvedValueOnce({ ok: true, data: DATA });
    await act(async () => {
      vi.advanceTimersByTime(REMINDER_POLL_MS);
    });
    expect(title()).toBe("Handyman on Wednesday");

    // The iPad waking asks at once.
    listAction.mockResolvedValueOnce({
      ok: true,
      data: { ...DATA, reminders: [R2] },
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(title()).toBe("Water off Friday");

    // A new render of the shell wins.
    act(() => root!.render(<KioskReminders initial={DATA} />));
    expect(title()).toBe("Handyman on Wednesday");
  });
});
