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
import { BaumyApproval, POLL_MS } from "./baumy-approval";

// The "Sign in with Baumy" screen (issue #80): the number, the wait, and one
// exchange once the member approved; the other endings say what happened.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let statuses: string[] = [];
let calls: string[] = [];
const assign = vi.fn();
const onCancel = vi.fn();

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  statuses = [];
  calls = [];
  assign.mockReset();
  onCancel.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/start")) {
        const { email } = JSON.parse(String(init!.body)) as { email: string };
        if (email === "slow@example.com") {
          return answer(
            { ok: false, code: "RATE_LIMITED", message: "Wait 30s." },
            429,
          );
        }
        return answer({
          ok: true,
          code: 47,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          message: "If this account is linked, Baumy has sent you a message.",
        });
      }
      if (url.endsWith("/status")) {
        return answer({ ok: true, status: statuses.shift() ?? "pending" });
      }
      if (url.endsWith("/exchange")) return answer({ ok: true });
      return answer({}, 404);
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function mountAndStart(email = "ryan@example.com") {
  const div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  act(() =>
    root!.render(
      <BaumyApproval
        initialEmail={email}
        callbackURL="/settings"
        onCancel={onCancel}
      />,
    ),
  );
  const form = document.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flush();
  });
}

async function poll() {
  await act(async () => {
    vi.advanceTimersByTime(POLL_MS);
    await flush();
  });
}

describe("BaumyApproval", () => {
  it("shows the number, waits, then signs in once approved", async () => {
    await mountAndStart();
    expect(
      document.querySelector('[data-testid="baumy-login-code"]')?.textContent,
    ).toBe("47");
    expect(document.body.textContent).toContain("Baumy has sent you a message");
    expect(document.body.textContent).toContain("120s");

    statuses = ["pending", "approved"];
    await poll();
    expect(assign).not.toHaveBeenCalled();
    await poll();
    await act(flush);
    expect(
      calls.filter((c) => c.startsWith("POST") && c.endsWith("/exchange")),
    ).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith("/settings");
  });

  it("says so when the member denied it, and offers another go", async () => {
    await mountAndStart();
    statuses = ["denied"];
    await poll();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "denied in Telegram",
    );
    expect(calls.some((c) => c.endsWith("/exchange"))).toBe(false);
    const again = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again",
    )!;
    act(() => again.click());
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("says so when nobody answered in time", async () => {
    await mountAndStart();
    statuses = ["expired"];
    await poll();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Nobody answered in time",
    );
  });

  it("shows the start route's refusal inline", async () => {
    await mountAndStart("slow@example.com");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Wait 30s.",
    );
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("goes back to the password form", async () => {
    await mountAndStart();
    const back = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Use your password instead",
    )!;
    act(() => back.click());
    expect(onCancel).toHaveBeenCalled();
  });
});
