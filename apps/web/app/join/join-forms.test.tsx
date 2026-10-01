import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";

// /join's invite form: a refusal of the whole input (a stale form still
// sending the drawn character's fields, issue #116) is said, not swallowed;
// field errors stay inline.

const redeem = vi.fn<() => Promise<ActionResult<unknown>>>();
vi.mock("./actions", () => ({
  redeemInviteAction: () => redeem(),
  joinAsFounderAction: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

const { InviteForm, STALE_FORM } = await import("./join-forms");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function submitWith(result: ActionResult<unknown>) {
  redeem.mockResolvedValue(result);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(<InviteForm gallery={[]} />));
  // Filled in, so the browser's own required-field check lets it through.
  for (const input of el.querySelectorAll<HTMLInputElement>(
    'input[name="code"], input[name="displayName"]',
  )) {
    input.value = "x";
  }
  await act(async () => el.querySelector("form")!.requestSubmit());
  return el;
}

describe("InviteForm", () => {
  it("says why when the whole input is refused", async () => {
    const el = await submitWith({
      ok: false,
      code: "INVALID_INPUT",
      message: "Some of that is not valid. Check it and try again.",
      issues: [{ path: [], message: 'Unrecognized key: "hairStyle"' }],
    });
    expect(el.textContent).toContain(STALE_FORM);
    expect(STALE_FORM).toContain("Reload the page and try again.");
  });

  it("keeps field errors inline, without the general message", async () => {
    const el = await submitWith({
      ok: false,
      code: "INVALID_INPUT",
      message: "Some of that is not valid. Check it and try again.",
      issues: [{ path: ["code"], message: "Enter your invite code." }],
    });
    expect(el.textContent).toContain("Enter your invite code.");
    expect(el.textContent).not.toContain("Check it and try again.");
    expect(el.textContent).not.toContain(STALE_FORM);
  });
});
