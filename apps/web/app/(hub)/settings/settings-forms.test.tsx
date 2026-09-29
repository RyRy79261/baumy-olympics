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
import type { TelegramLinkCodeData } from "@/lib/actions/create-telegram-link-code";
import type { TelegramLinkStatus } from "@/lib/actions/get-telegram-link-status";
import type { ActionResult } from "@/lib/actions/result";

// The Settings Telegram card (issue #118): "Linked" comes from the member's
// newest code being used, so a member who is already linked and relinks the
// same Telegram account still sees it; an expired code turns into a prompt
// for a new link.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const createCode = vi.fn<() => Promise<ActionResult<TelegramLinkCodeData>>>();
const linkStatus = vi.fn<() => Promise<ActionResult<TelegramLinkStatus>>>();
vi.mock("./actions", () => ({
  createTelegramLinkCodeAction: () => createCode(),
  setKioskPinAction: vi.fn(),
  telegramLinkStatusAction: () => linkStatus(),
}));

const { TelegramLinkForm } = await import("./settings-forms");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const CODE = "ABCDEFGH23";
const NEXT_CODE = "JKLMNPQR45";
const status = (
  state: "waiting" | "used" | "expired",
  secondsLeft = 0,
): ActionResult<TelegramLinkStatus> => ({
  ok: true,
  data: { linked: true, code: { state, secondsLeft } },
});

let root: Root | null = null;
let el: HTMLDivElement;

beforeEach(() => {
  refresh.mockReset();
  createCode.mockReset();
  linkStatus.mockReset();
  createCode.mockResolvedValue({
    ok: true,
    data: {
      code: CODE,
      expiresAt: "2026-09-27T10:10:00.000Z",
      expiresInSeconds: 600,
    },
  });
  linkStatus.mockResolvedValue(status("waiting", 600));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el?.remove();
});

async function mount(linked: boolean) {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root!.render(<TelegramLinkForm linked={linked} botUsername="baumy_bot" />),
  );
}

const button = (name: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === name);
const openTelegram = () =>
  [...el.querySelectorAll("a")].find((a) => a.textContent === "Open Telegram");

async function makeLink(label: string) {
  await act(async () => button(label)!.click());
  expect(createCode).toHaveBeenCalledTimes(1);
  expect(openTelegram()?.getAttribute("href")).toBe(
    `https://t.me/baumy_bot?start=link_${CODE}`,
  );
}

/** The member comes back to the tab: the card asks the server at once. */
async function comeBack() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

describe("TelegramLinkForm", () => {
  it("says Linked when an already linked member relinks the same account", async () => {
    await mount(true);
    expect(el.textContent).toContain("Your Telegram account is linked.");
    await makeLink("Link Telegram");

    // Still waiting: the Telegram id the page knows is the same as before.
    await comeBack();
    expect(linkStatus).toHaveBeenCalledTimes(1);
    expect(openTelegram()).toBeDefined();
    expect(el.textContent).not.toContain("Linked. @baumy_bot");

    // The bot used the code for the same Telegram account.
    linkStatus.mockResolvedValue(status("used"));
    await comeBack();
    expect(el.textContent).toContain(
      "Linked. @baumy_bot knows who you are now.",
    );
    expect(openTelegram()).toBeUndefined();
    expect(button("Make a new link")).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Used: it stops asking.
    await comeBack();
    expect(linkStatus).toHaveBeenCalledTimes(2);
  });

  it("turns an expired code into a prompt for a new link", async () => {
    await mount(false);
    expect(el.textContent).toContain("Link your Telegram account");
    await makeLink("Link Telegram");

    linkStatus.mockResolvedValue(status("expired"));
    await comeBack();
    expect(el.textContent).toContain("That link has expired. Make a new one.");
    expect(openTelegram()).toBeUndefined();
    expect(el.textContent).not.toContain(CODE);
    expect(button("Make a new link")).toBeDefined();
    expect(refresh).not.toHaveBeenCalled();

    // A new link (every code is new) starts waiting again.
    linkStatus.mockResolvedValue(status("waiting", 600));
    createCode.mockResolvedValue({
      ok: true,
      data: {
        code: NEXT_CODE,
        expiresAt: "2026-09-27T10:20:00.000Z",
        expiresInSeconds: 600,
      },
    });
    await act(async () => button("Make a new link")!.click());
    expect(createCode).toHaveBeenCalledTimes(2);
    expect(openTelegram()?.getAttribute("href")).toBe(
      `https://t.me/baumy_bot?start=link_${NEXT_CODE}`,
    );
    expect(el.textContent).not.toContain("That link has expired.");
  });
});
