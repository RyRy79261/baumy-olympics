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

// Issue #181, owner ruling 2026-10-06: the "+N" floats where the bounty was
// when it was tapped, though logging re-sorts the board and the row moves
// or leaves the tab; the page never scrolls. From the dashboard's "I'll do
// it" (no tap on a row) it floats in the middle of the screen.
describe("ChoreGrid's floating score (issue #181)", () => {
  const bathroom: ChoreView = {
    ...chore,
    id: "c-0",
    name: "Bathroom",
    basePoints: 26,
  };
  const zebra: ChoreView = { ...chore, id: "c-9", name: "Zebra" };
  const TAPPED = { top: 480, left: 16, width: 788, height: 122 };

  // jsdom lays nothing out and does not scroll: record any scroll instead,
  // and put the original methods back after each test.
  const scrollIntoView = Element.prototype.scrollIntoView;
  const scrollTo = window.scrollTo;
  const scrolls = vi.fn();
  beforeEach(() => {
    scrolls.mockClear();
    Element.prototype.scrollIntoView = scrolls;
    window.scrollTo = scrolls as typeof window.scrollTo;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
    window.scrollTo = scrollTo;
  });

  /** The board with no sheet open, and its answer to "Log it". */
  async function board(chores: ChoreView[]) {
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
    const render = (list: ChoreView[]) =>
      act(async () =>
        root!.render(
          <ChoreGrid
            chores={list}
            members={[{ id: "m-1", displayName: "Ryan" }]}
            actorId="m-1"
            kiosk
            action={action}
          />,
        ),
      );
    await render(chores);
    return {
      render,
      answer: (r: ActionResult<LogCompletionData> = LOGGED) => answer(r),
    };
  }

  /** Tap a row that sits at `box` on the screen and log it. */
  async function tapAndLog(
    name: string,
    answer: () => void,
    /** What happens between the tap and the answer. */
    meanwhile?: () => void,
  ) {
    const row = document.querySelector<HTMLButtonElement>(
      `[data-testid="chore-${name}"] button`,
    )!;
    expect(row).not.toBeNull();
    row.getBoundingClientRect = () =>
      ({ ...TAPPED, right: 804, bottom: 602, x: 16, y: 480 }) as DOMRect;
    await act(async () => row.click());
    const sheet = document.querySelector<HTMLDialogElement>(
      `dialog[aria-label="Log ${name}"]`,
    )!;
    expect(sheet.open).toBe(true);
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    meanwhile?.();
    await act(async () => answer());
    expect(sheet.open).toBe(false);
  }

  function theFloat() {
    const pops = document.querySelectorAll<HTMLElement>(
      '[data-testid="score-pop"]',
    );
    expect(pops).toHaveLength(1);
    return pops[0]!;
  }

  function expectAtTheTap(pop: HTMLElement) {
    expect(pop.getAttribute("data-placement")).toBe("box");
    expect(pop.style.top).toBe("480px");
    expect(pop.style.left).toBe("16px");
    expect(pop.style.width).toBe("788px");
    expect(pop.style.height).toBe("122px");
    expect(pop.className).toContain("fixed");
    expect(pop.closest("li")).toBeNull();
  }

  it("stays where the row was tapped when it re-sorts to the end, and nothing scrolls", async () => {
    const { render, answer } = await board([bathroom, chore, zebra]);
    await tapAndLog("Trash", answer);
    // The re-render after logging: Trash is in its cooldown now, last.
    await render([bathroom, zebra, { ...chore, state: "unavailable" }]);
    const order = [
      ...document.querySelectorAll("li[data-testid^='chore-']"),
    ].map((li) => li.getAttribute("data-testid"));
    expect(order).toEqual(["chore-Bathroom", "chore-Zebra", "chore-Trash"]);

    const pop = theFloat();
    expect(getToasts().map((t) => t.title)).toContain(
      "Logged Trash for Ryan: +40.",
    );
    expect(pop.textContent).toBe("+40");
    expectAtTheTap(pop);
    expect(scrolls).not.toHaveBeenCalled();
  });

  it("stays where the row was tapped when the Urgent tab drops it", async () => {
    const urgent = { ...chore, urgent: true };
    const { render, answer } = await board([bathroom, urgent]);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-tab="urgent"]')!.click(),
    );
    expect(document.querySelector('[data-testid="chore-Bathroom"]')).toBeNull();
    await tapAndLog("Trash", answer);
    await render([bathroom, { ...urgent, urgent: false }]);
    expect(document.querySelector('[data-testid="chore-Trash"]')).toBeNull();

    const pop = theFloat();
    expect(pop.textContent).toBe("+40");
    expectAtTheTap(pop);
    expect(scrolls).not.toHaveBeenCalled();
  });

  it("floats in the middle of the screen from the dashboard's I'll do it", async () => {
    const { sheet, answer } = await openSheet();
    await act(async () => sheet.querySelector("form")!.requestSubmit());
    await act(async () => answer());

    const pop = theFloat();
    expect(pop.textContent).toBe("+40");
    expect(pop.getAttribute("data-placement")).toBe("middle");
    expect(pop.className).toContain("inset-0");
    expect(pop.style.top).toBe("");
    expect(scrolls).not.toHaveBeenCalled();
  });

  it("floats in the middle when the tapped spot is off the screen by then", async () => {
    const height = window.innerHeight;
    try {
      const { answer } = await board([bathroom, chore]);
      // The tapped row's middle (y 541) is on a 768px-tall screen; turned
      // sideways before the answer, the screen is 400px tall.
      expect(window.innerHeight).toBeGreaterThan(541);
      await tapAndLog("Trash", answer, () => {
        window.innerHeight = 400;
      });
      const pop = theFloat();
      expect(pop.textContent).toBe("+40");
      expect(pop.getAttribute("data-placement")).toBe("middle");
      expect(pop.style.top).toBe("");
    } finally {
      window.innerHeight = height;
    }
  });

  it("shows no float when the log fails", async () => {
    const { answer } = await board([bathroom, chore]);
    await tapAndLog("Trash", () =>
      answer({ ok: false, code: "COOLDOWN", message: "Not yet." }),
    );
    expect(getToasts().map((t) => t.title)).toContain("Not yet.");
    expect(document.querySelector('[data-testid="score-pop"]')).toBeNull();
  });
});
