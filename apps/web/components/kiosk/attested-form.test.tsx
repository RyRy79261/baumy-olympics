import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import { SET_PIN_URL } from "@/lib/kiosk/constants";
import { ActingPinProvider } from "./acting-pin";
import { AttestedForm } from "./attested-form";

// The kiosk's attested form (SPEC §6.2, issue #145): a member with a PIN
// gets the PinPad when the gate asks for it; a member who never set one
// gets "<Name> hasn't set a personal PIN yet" and a QR code to Settings,
// never a PinPad they cannot use.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    // As a browser does: the dialog says it closed.
    this.dispatchEvent(new Event("close"));
  };
});

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const NEEDS_PIN: ActionResult<unknown> = {
  ok: false,
  code: "ATTESTATION_REQUIRED",
  message: "Enter your PIN to do this.",
};

async function tap(
  result: ActionResult<unknown>,
  acting?: { name?: string; hasPin: boolean },
) {
  const action = vi.fn(async () => result);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  const form = (
    <AttestedForm action={action} label="Confirm" pinLabel="Charl's PIN" />
  );
  await act(async () =>
    root!.render(
      acting ? (
        <ActingPinProvider value={acting}>{form}</ActingPinProvider>
      ) : (
        form
      ),
    ),
  );
  await act(async () => el.querySelector("form")!.requestSubmit());
  return { el, action };
}

const pad = (el: HTMLElement) =>
  el.querySelector('[role="group"][aria-label="Charl\'s PIN"]');

describe("AttestedForm", () => {
  it("opens the PinPad for a member who has a PIN", async () => {
    const { el, action } = await tap(NEEDS_PIN, {
      name: "Charl",
      hasPin: true,
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(pad(el)).not.toBeNull();
    expect(el.querySelector('[data-testid="no-pin-notice"]')).toBeNull();
  });

  it("holds the PIN dialog open while the PIN is being checked (#174)", async () => {
    let answer!: (r: ActionResult<unknown>) => void;
    const action = vi
      .fn<() => Promise<ActionResult<unknown>>>()
      .mockResolvedValueOnce(NEEDS_PIN)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            answer = r;
          }),
      );
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () =>
      root!.render(
        <ActingPinProvider value={{ name: "Charl", hasPin: true }}>
          <AttestedForm
            action={action}
            label="Confirm"
            pinLabel="Charl's PIN"
          />
        </ActingPinProvider>,
      ),
    );
    await act(async () => el.querySelector("form")!.requestSubmit());
    const dialog = el.querySelector<HTMLDialogElement>("dialog")!;
    expect(dialog.open).toBe(true);
    expect(pad(el)).not.toBeNull();
    const close = dialog.querySelector<HTMLButtonElement>(
      ':scope > div > button[aria-label="Close"]',
    )!;
    expect(close.disabled).toBe(false);
    // OK sends the same form again, with the PIN; it is being checked.
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(action).toHaveBeenCalledTimes(2);
    let answered = false;
    try {
      expect(close.disabled).toBe(true);
      await act(async () => {
        dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(dialog.open).toBe(true);
      await act(async () => answer({ ok: true, data: null }));
      answered = true;
      expect(close.disabled).toBe(false);
    } finally {
      // Never leave the request hanging for the tests after this one.
      if (!answered) await act(async () => answer({ ok: true, data: null }));
    }
  });

  it("shows who has no PIN, what it is for and the QR code, never the PinPad", async () => {
    const { el } = await tap(NEEDS_PIN, { name: "Charl", hasPin: false });
    const notice = el.querySelector('[data-testid="no-pin-notice"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain(
      "Charl hasn't set a personal PIN yet",
    );
    expect(notice!.textContent).toContain(
      "asks for it only to dispute a chore",
    );
    expect(
      notice!.querySelector(
        '[aria-label="QR code: set your personal PIN in Settings"]',
      ),
    ).not.toBeNull();
    expect(SET_PIN_URL).toBe("https://www.baumy.tech/settings#pin");
    expect(pad(el)).toBeNull();
    expect(el.textContent).not.toContain("Enter your PIN");
  });

  it("shows the same when the gate says the PIN was never set", async () => {
    const { el } = await tap(
      {
        ok: false,
        code: "PIN_NOT_SET",
        message:
          "You haven't set a personal PIN yet. Set one in Settings on your phone.",
      },
      { name: "Charl", hasPin: true },
    );
    expect(el.querySelector('[data-testid="no-pin-notice"]')).not.toBeNull();
    expect(pad(el)).toBeNull();
  });

  it("keeps a typed dispute reason when the no-PIN help replaces the pad", async () => {
    const action = vi.fn(async () => NEEDS_PIN);
    function Dispute() {
      // Controlled, as the claim list's dispute form is.
      const [reason, setReason] = useState("");
      return (
        <AttestedForm
          action={action}
          label="Send dispute"
          pinLabel="Charl's PIN"
          fields={
            <textarea
              name="reason"
              aria-label="Why was it not done?"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
          }
        />
      );
    }
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () =>
      root!.render(
        <ActingPinProvider value={{ name: "Charl", hasPin: false }}>
          <Dispute />
        </ActingPinProvider>,
      ),
    );
    const box = el.querySelector("textarea")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      set.call(box, "Still dirty");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(el.querySelector('[data-testid="no-pin-notice"]')).not.toBeNull();
    expect(el.querySelector("textarea")!.value).toBe("Still dirty");
    const close = el.querySelector<HTMLButtonElement>(
      'dialog[open] button[aria-label="Close"]',
    )!;
    expect(close).not.toBeNull();
    await act(async () => close.click());
    // The corner's Close puts the notice away and keeps what was typed.
    expect(el.querySelector("dialog[open]")).toBeNull();
    expect(el.querySelector("textarea")!.value).toBe("Still dirty");
  });

  it("says when its request is on its way and when the answer is in (#174)", async () => {
    let answer!: (r: ActionResult<unknown>) => void;
    const action = vi.fn(
      () =>
        new Promise<ActionResult<unknown>>((r) => {
          answer = r;
        }),
    );
    const onPending = vi.fn();
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () =>
      root!.render(
        <AttestedForm
          action={action}
          label="Log it"
          pinLabel="Charl's PIN"
          onResult={() => {}}
          onPending={onPending}
        />,
      ),
    );
    expect(onPending).toHaveBeenLastCalledWith(false);
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(onPending).toHaveBeenLastCalledWith(true);
    await act(async () => answer({ ok: true, data: null }));
    expect(onPending).toHaveBeenLastCalledWith(false);
  });

  it("asks nothing for an action that needs no PIN", async () => {
    const { el } = await tap({ ok: true, data: null }, { hasPin: false });
    expect(el.querySelector('[data-testid="no-pin-notice"]')).toBeNull();
    expect(pad(el)).toBeNull();
  });
});
