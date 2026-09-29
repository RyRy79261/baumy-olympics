import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TelegramUserId } from "@baumy/types";
import {
  DIGITS_ONLY,
  TelegramIdField,
  telegramIdError,
} from "./telegram-id-field";

// The admin card's Telegram id field: digits only as it is typed, and the
// "How do I find this?" popup (owner request, issue #106).

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has <dialog> but not showModal/close.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

/** Type into a controlled input the way React sees it. */
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("telegramIdError", () => {
  it("allows digits or nothing, and says the same as the server otherwise", () => {
    expect(telegramIdError("")).toBeUndefined();
    expect(telegramIdError(" 123456789 ")).toBeUndefined();
    expect(telegramIdError("@ryan")).toBe(DIGITS_ONLY);
    expect(telegramIdError("12a")).toBe(DIGITS_ONLY);
    // The server's rules exactly: no leading 0, no zero, at most 16 digits,
    // and within a JS number.
    expect(telegramIdError("0")).toBe(DIGITS_ONLY);
    expect(telegramIdError("0123")).toBe(DIGITS_ONLY);
    expect(telegramIdError("12345678901234567")).toBe(DIGITS_ONLY);
    expect(telegramIdError("9999999999999999")).toBe(DIGITS_ONLY);
    expect(telegramIdError("9007199254740991")).toBeUndefined();
    for (const v of ["0", "0123", "12345678901234567", "12a", "42"]) {
      expect(telegramIdError(v) === undefined).toBe(
        TelegramUserId.safeParse(v).success,
      );
    }
    // The same sentence manage_members' schema answers with.
    const server = TelegramUserId.safeParse("@ryan");
    expect(server.error?.issues[0]?.message).toBe(DIGITS_ONLY);
  });
});

describe("TelegramIdField", () => {
  it("shows the digits-only error inline as soon as a non-digit is typed", async () => {
    const onValidity = vi.fn();
    const c = await mount(
      <TelegramIdField
        memberId="m1"
        displayName="Jo"
        initial=""
        onValidity={onValidity}
      />,
    );
    const input = c.querySelector<HTMLInputElement>("#telegram-m1")!;
    expect(input.name).toBe("telegramUserId");
    expect(input.inputMode).toBe("numeric");
    await type(input, "123");
    expect(onValidity).toHaveBeenLastCalledWith(true);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    await type(input, "123@");
    expect(onValidity).toHaveBeenLastCalledWith(false);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = c.querySelector("#telegram-m1-error")!;
    expect(error.textContent).toBe(DIGITS_ONLY);
    expect(input.getAttribute("aria-describedby")).toContain(
      "telegram-m1-error",
    );
    await type(input, "123");
    expect(c.querySelector("#telegram-m1-error")).toBeNull();
  });

  it("shows the server's error when what is typed is fine", async () => {
    const c = await mount(
      <TelegramIdField
        memberId="m1"
        displayName="Jo"
        initial="42"
        serverErrors={["That Telegram id is linked to Sam."]}
      />,
    );
    expect(c.querySelector("#telegram-m1-error")!.textContent).toBe(
      "That Telegram id is linked to Sam.",
    );
  });

  it("explains how to find the id in a popup, easiest way first", async () => {
    const c = await mount(
      <TelegramIdField memberId="m1" displayName="Jo" initial="" />,
    );
    const dialog = c.querySelector("dialog")!;
    expect(dialog.open).toBe(false);
    const help = [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "How do I find this?",
    )!;
    expect(help.type).toBe("button");
    await act(async () => help.click());
    expect(dialog.open).toBe(true);
    const text = c.querySelector('[data-testid="telegram-help"]')!.textContent!;
    expect(text).toContain("Create a link code");
    expect(text).toContain("@baumy_bot");
    expect(text).toContain("@userinfobot");
    expect(text).toContain("@getidsbot");
    expect(text).toContain("Enter only the digits");
    expect(text.indexOf("@baumy_bot")).toBeLessThan(
      text.indexOf("@userinfobot"),
    );
    const done = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Got it",
    )!;
    expect(done.type).toBe("button");
    await act(async () => done.click());
    expect(dialog.open).toBe(false);
  });
});
